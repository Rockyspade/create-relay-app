import traverse, { NodePath } from "@babel/traverse";
import { TaskBase } from "./TaskBase.js";
import t from "@babel/types";
import { REACT_RELAY_PACKAGE } from "../consts.js";
import {
  h,
  insertNamedImport,
  parseAst,
  printAst,
  readFromFile,
  removeExtension,
  writeToFile,
} from "../utils/index.js";
import { ProjectContext } from "../ProjectContext.js";

const RELAY_ENV_PROVIDER = "RelayEnvironmentProvider";
const RELAY_ENV = "RelayEnvironment";

export class AddRelayEnvironmentProviderTask extends TaskBase {
  message: string = "Add RelayEnvironmentProvider";

  constructor(private context: ProjectContext) {
    super();
  }

  isEnabled(): boolean {
    return true;
  }

  async run(): Promise<void> {
    this.updateMessage(this.message + " to " + h(this.context.mainFile.rel));

    // todo: pull toolchain specific settings out
    switch (this.context.args.toolchain) {
      case "vite":
      case "cra":
        await this.configureViteOrCra();
        break;
      case "next":
        await this.configureNext();
        break;
      default:
        throw new Error(
          `Unsupported toolchain: ${this.context.args.toolchain}`
        );
    }
  }

  async configureNext() {
    const code = await readFromFile(this.context.mainFile.abs);

    const ast = parseAst(code);

    let providerWrapped = false;

    traverse.default(ast, {
      JSXElement: (path) => {
        // Find first JSX being returned *somewhere*.
        if (providerWrapped || !path.parentPath.isReturnStatement()) {
          return;
        }

        this.wrapJsxInProvider(path);

        providerWrapped = true;

        path.skip();
      },
    });

    if (!providerWrapped) {
      throw new Error(`Could not find JSX in ${h(this.context.mainFile.rel)}`);
    }

    const updatedCode = printAst(ast, code);

    await writeToFile(this.context.mainFile.abs, updatedCode);
  }

  async configureViteOrCra() {
    const code = await readFromFile(this.context.mainFile.abs);

    const ast = parseAst(code);

    let providerWrapped = false;

    traverse.default(ast, {
      JSXElement: (path) => {
        if (providerWrapped) {
          return;
        }

        const parent = path.parentPath.node;

        // Find ReactDOM.render(...)
        if (
          !t.isCallExpression(parent) ||
          !t.isMemberExpression(parent.callee) ||
          !t.isIdentifier(parent.callee.property) ||
          parent.callee.property.name !== "render"
        ) {
          return;
        }

        this.wrapJsxInProvider(path);

        providerWrapped = true;

        path.skip();
      },
    });

    if (!providerWrapped) {
      throw new Error(
        `Could not find JSX being passed to ReactDOM.render in ${h(
          this.context.mainFile.rel
        )}`
      );
    }

    const updatedCode = printAst(ast, code);

    await writeToFile(this.context.mainFile.abs, updatedCode);
  }

  private wrapJsxInProvider(jsxPath: NodePath<t.JSXElement>) {
    // todo: correctly export
    const relativeImportPath = "";
    //  prettifyRelativePath(
    //   this.settings.mainFile.parentDirectory,
    //   removeExtension(this.settings.relayEnvFile.rel)
    // );

    const envId = insertNamedImport(jsxPath, RELAY_ENV, relativeImportPath);

    const envProviderId = t.jsxIdentifier(
      insertNamedImport(jsxPath, RELAY_ENV_PROVIDER, REACT_RELAY_PACKAGE).name
    );

    if (
      t.isJSXIdentifier(jsxPath.node.openingElement.name) &&
      jsxPath.node.openingElement.name.name === envProviderId.name
    ) {
      this.skip(`JSX already wrapped with ${h(RELAY_ENV_PROVIDER)}`);
      return;
    }

    const test = t.jsxExpressionContainer(envId);

    // Wrap JSX into RelayEnvironmentProvider.
    jsxPath.replaceWith(
      t.jsxElement(
        t.jsxOpeningElement(envProviderId, [
          t.jsxAttribute(t.jsxIdentifier("environment"), test),
        ]),
        t.jsxClosingElement(envProviderId),
        [jsxPath.node]
      )
    );
  }
}
