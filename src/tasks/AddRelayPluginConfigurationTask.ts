import { findFileInDirectory, getRelayCompilerLanguage } from "../helpers.js";
import { TaskBase } from "../TaskBase.js";
import { ProjectSettings, Toolchain } from "../types.js";
import fs from "fs/promises";
import traverse from "@babel/traverse";
import t from "@babel/types";
import { NEXTJS_CONFIG_FILE, VITE_CONFIG_FILE_NO_EXT } from "../consts.js";
import { parseAst, printAst } from "../ast.js";

export class AddRelayPluginConfigurationTask extends TaskBase {
  constructor(private settings: ProjectSettings) {
    super();
  }

  async run(): Promise<void> {
    switch (this.settings.toolchain) {
      case "vite":
        await this.configureVite();
        break;
      case "next":
        await this.configureNext();
        break;
      default:
        throw new Error(`Unsupported toolchain: ${this.settings.toolchain}`);
    }
  }

  private async configureNext() {
    const configFilepath = await findFileInDirectory(
      this.settings.projectRootDirectory,
      NEXTJS_CONFIG_FILE
    );

    if (!configFilepath) {
      throw new Error(`${NEXTJS_CONFIG_FILE} not found`);
    }

    // todo: handle errors
    const configCode = await fs.readFile(configFilepath, "utf-8");

    const ast = parseAst(configCode);

    traverse.default(ast, {
      AssignmentExpression: (path) => {
        const node = path.node;

        // We are looking for module.exports = ???.
        if (
          node.operator !== "=" ||
          !t.isMemberExpression(node.left) ||
          !t.isIdentifier(node.left.object) ||
          !t.isIdentifier(node.left.property) ||
          node.left.object.name !== "module" ||
          node.left.property.name !== "exports"
        ) {
          throw new Error(
            `Expected to find a module.exports assignment that exports the Next.js configuration from ${NEXTJS_CONFIG_FILE}.`
          );
        }

        let objExp: t.ObjectExpression;

        // We are looking for the object expression
        // that was assigned to module.exports.
        if (t.isIdentifier(node.right)) {
          // The export is linked to a variable,
          // so we need to resolve the variable declaration.
          const binding = path.scope.getBinding(node.right.name);

          if (
            !binding ||
            !t.isVariableDeclarator(binding.path.node) ||
            !t.isObjectExpression(binding.path.node.init)
          ) {
            throw new Error(
              `module.exports in ${NEXTJS_CONFIG_FILE} references a variable, which is not a valid object definition.`
            );
          }

          objExp = binding.path.node.init;
        } else if (t.isObjectExpression(node.right)) {
          objExp = node.right;
        } else {
          throw new Error(
            `Expected to find a module.exports assignment that exports the Next.js configuration from ${NEXTJS_CONFIG_FILE}.`
          );
        }

        // We are creating or getting the 'compiler' property.
        let compilerProperty = objExp.properties.find(
          (p) =>
            t.isObjectProperty(p) &&
            t.isIdentifier(p.key) &&
            p.key.name === "compiler"
        ) as t.ObjectProperty;

        if (!compilerProperty) {
          compilerProperty = t.objectProperty(
            t.identifier("compiler"),
            t.objectExpression([])
          );

          objExp.properties.push(compilerProperty);
        }

        if (!t.isObjectExpression(compilerProperty.value)) {
          throw new Error(
            `Could not create or get a "compiler" property on the Next.js configuration object in ${NEXTJS_CONFIG_FILE}.`
          );
        }

        const relayProperty = compilerProperty.value.properties.find(
          (p) =>
            t.isObjectProperty(p) &&
            t.isIdentifier(p.key) &&
            p.key.name === "relay"
        );

        if (!!relayProperty) {
          // A "relay" property already exists.
          return;
        }

        const objProperties: t.ObjectProperty[] = [
          t.objectProperty(
            t.identifier("src"),
            t.stringLiteral(this.settings.srcDirectoryPath)
          ),
          t.objectProperty(
            t.identifier("language"),
            t.stringLiteral(
              getRelayCompilerLanguage(this.settings.useTypescript)
            )
          ),
        ];

        if (this.settings.artifactDirectoryPath) {
          objProperties.push(
            t.objectProperty(
              t.identifier("artifactDirectory"),
              t.stringLiteral(this.settings.artifactDirectoryPath)
            )
          );
        }

        // Add the "relay" property to the "compiler" property object.
        compilerProperty.value.properties.push(
          t.objectProperty(
            t.identifier("relay"),
            t.objectExpression(objProperties)
          )
        );
      },
    });

    const updatedConfigCode = printAst(ast, configCode);

    await fs.writeFile(configFilepath, updatedConfigCode, "utf-8");
  }

  private async configureVite() {
    const relayImportName = "relay";

    const configFilename =
      VITE_CONFIG_FILE_NO_EXT + (this.settings.useTypescript ? ".ts" : ".js");

    const configFilepath = await findFileInDirectory(
      this.settings.projectRootDirectory,
      configFilename
    );

    if (!configFilepath) {
      throw new Error(`${configFilename} not found`);
    }

    // todo: handle errors
    const configCode = await fs.readFile(configFilepath, "utf-8");

    const ast = parseAst(configCode);

    traverse.default(ast, {
      Program: (path) => {
        const hasRelayImport = path
          .get("body")
          .some(
            (s) =>
              s.isImportDeclaration() &&
              s.node.specifiers.some(
                (sp) =>
                  t.isImportDefaultSpecifier(sp) &&
                  sp.local.name === relayImportName
              )
          );

        if (hasRelayImport) {
          // Import already exists.
          return;
        }

        const importDeclaration = t.importDeclaration(
          [t.importDefaultSpecifier(t.identifier(relayImportName))],
          // todo: replace with VITE_RELAY_PACKAGE,
          // once it no longer has the explict version
          t.stringLiteral("vite-plugin-relay")
        );

        // Insert import at start of file.
        path.node.body.unshift(importDeclaration);
      },
      ExportDefaultDeclaration: (path) => {
        const node = path.node;

        // Find export default defineConfig(???)
        if (
          !t.isCallExpression(node.declaration) ||
          node.declaration.arguments.length < 1 ||
          !t.isIdentifier(node.declaration.callee) ||
          node.declaration.callee.name !== "defineConfig"
        ) {
          throw new Error(
            `Expected a export default defineConfig({}) in ${configFilename}.`
          );
        }

        const arg = node.declaration.arguments[0];

        if (!t.isObjectExpression(arg)) {
          throw new Error(
            `Expected a export default defineConfig({}) in ${configFilename}.`
          );
        }

        // We are creating or getting the 'plugins' property.
        let pluginsProperty = arg.properties.find(
          (p) =>
            t.isObjectProperty(p) &&
            t.isIdentifier(p.key) &&
            p.key.name === "plugins"
        ) as t.ObjectProperty;

        if (!pluginsProperty) {
          pluginsProperty = t.objectProperty(
            t.identifier("plugins"),
            t.arrayExpression([])
          );

          arg.properties.push(pluginsProperty);
        }

        if (!t.isArrayExpression(pluginsProperty.value)) {
          throw new Error(
            `Could not create or get a "plugins" property on the Vite configuration object in ${configFilename}.`
          );
        }

        const vitePlugins = pluginsProperty.value.elements;

        if (
          vitePlugins.some(
            (p) => t.isIdentifier(p) && p.name === relayImportName
          )
        ) {
          // A "relay" entry already exists.
          return;
        }

        const relayPlugin = t.identifier(relayImportName);

        // Add the "relay" import to the "plugins".
        vitePlugins.push(relayPlugin);
      },
    });

    const updatedConfigCode = printAst(ast, configCode);

    await fs.writeFile(configFilepath, updatedConfigCode, "utf-8");
  }
}
