import path from "path";
import fs from "fs/promises";
import {
  CliArguments,
  EnvArguments,
  ProjectSettings,
  Toolchain,
} from "./types.js";
import {
  BABEL_RELAY_PACKAGE,
  PACKAGE_FILE,
  VITE_RELAY_PACKAGE,
} from "./consts.js";
import glob from "glob";
import chalk from "chalk";

export function printInvalidArg(
  arg: string,
  validationMsg: string,
  value?: string | null
) {
  printError(`Invalid ${arg} specified: ${value} ${chalk.dim(validationMsg)}`);
}

export function printError(message: string): void {
  console.log(chalk.red("✖") + " " + message);
}

export function highlight(message: string): string {
  return chalk.cyan.bold(message);
}

export async function traverseUpToFindFile(
  directory: string,
  filename: string
): Promise<string | null> {
  let currentDirectory = directory;
  let previousDirectory: string | null = null;

  while (!!currentDirectory) {
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const filepath = await findFileInDirectory(currentDirectory, filename);

    if (!!filepath) {
      return filepath;
    }

    previousDirectory = currentDirectory;
    currentDirectory = path.join(currentDirectory, "..");

    if (previousDirectory === currentDirectory) {
      // We reached the root.
      break;
    }
  }

  return null;
}

export async function findFileInDirectory(
  directory: string,
  filename: string
): Promise<string | null> {
  try {
    const filenames = await fs.readdir(directory);

    for (const name of filenames) {
      if (name === filename) {
        const filepath = path.join(directory, filename);

        return filepath;
      }
    }
  } catch {}

  return null;
}

export async function searchFilesInDirectory(
  directory: string,
  pattern: string
): Promise<string[]> {
  return new Promise((resolve) => {
    try {
      glob(pattern, { cwd: directory }, (error, matches) => {
        if (error || !matches || !matches.some((m) => !!m)) {
          resolve([]);
        } else {
          resolve(matches);
        }
      });
    } catch {
      resolve([]);
    }
  });
}

type PackageDetails = Readonly<{
  name: string;
  version: string;
  description: string;
}>;

export async function getPackageDetails(
  env: EnvArguments
): Promise<PackageDetails> {
  const ownPackageJsonFile = path.join(env.ownPackageDirectory, PACKAGE_FILE);

  const packageJsonContent = await fs.readFile(ownPackageJsonFile, "utf8");

  const packageJson = JSON.parse(packageJsonContent);

  const name = packageJson?.name;

  if (!name) {
    throw new Error(`Could not determine name in ${ownPackageJsonFile}`);
  }

  const version = packageJson?.version;

  if (!version) {
    throw new Error(`Could not determine version in ${ownPackageJsonFile}`);
  }

  const description = packageJson?.description;

  if (!description) {
    throw new Error(`Could not determine description in ${ownPackageJsonFile}`);
  }

  return { name, version, description };
}

export function getRelayDevDependencies(
  toolchain: Toolchain,
  useTypescript: boolean
) {
  const relayDevDep = ["relay-compiler"];

  if (useTypescript) {
    relayDevDep.push("@types/react-relay");
    relayDevDep.push("@types/relay-runtime");
  }

  if (toolchain === "cra" || toolchain === "vite") {
    relayDevDep.push(BABEL_RELAY_PACKAGE);
  }

  if (toolchain === "vite") {
    relayDevDep.push(VITE_RELAY_PACKAGE);
  }

  return relayDevDep;
}

export function getSpecifiedProperties<T extends object>(obj: Partial<T>): T {
  const keys = Object.keys(obj) as (keyof T)[];

  const newObj = {} as T;

  for (const key of keys) {
    if (obj[key] === null) {
      continue;
    }

    newObj[key] = obj[key]!;
  }

  return newObj;
}

export function isSubDirectory(parent: string, dir: string): boolean {
  const relative = path.relative(parent, dir);

  return !!relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function getRelativePath(root: string, leave: string): string {
  return normalizePath(path.relative(root, leave));
}

export function normalizePath(input: string): string {
  let unixPath = input.split(path.sep).join("/");

  if (!unixPath.startsWith("..") && !unixPath.startsWith("./")) {
    unixPath = "./" + unixPath;
  }

  return unixPath;
}

export function removeExtension(filename: string): string {
  return filename.substring(0, filename.lastIndexOf(".")) || filename;
}

export function getRelayCompilerLanguage(
  useTypescript: boolean
): "typescript" | "javascript" {
  if (useTypescript) {
    return "typescript";
  } else {
    return "javascript";
  }
}

export function getRelayEnvFilepath(
  env: EnvArguments,
  args: CliArguments
): string {
  const filename = "RelayEnvironment" + (args.typescript ? ".ts" : ".js");

  const directory = path.join(env.projectRootDirectory, "src");

  return path.join(directory, filename);
}

export async function getToolchainSettings(
  env: EnvArguments,
  args: CliArguments
): Promise<Pick<ProjectSettings, "mainFilepath" | "configFilepath">> {
  if (args.toolchain === "vite") {
    const configFilename = "vite.config" + (args.typescript ? ".ts" : ".js");

    const configFilepath = await findFileInDirectory(
      env.projectRootDirectory,
      configFilename
    );

    if (!configFilepath) {
      throw new Error(`${configFilename} not found`);
    }

    const mainFilename = "main" + (args.typescript ? ".tsx" : ".jsx");

    const searchDirectory = path.join(env.projectRootDirectory, "src");

    const mainFilepath = await findFileInDirectory(
      searchDirectory,
      mainFilename
    );

    if (!mainFilepath) {
      throw new Error(`${mainFilename} not found`);
    }

    return {
      configFilepath,
      mainFilepath,
    };
  } else if (args.toolchain === "next") {
    const configFilename = "next.config.js";

    const configFilepath = await findFileInDirectory(
      env.projectRootDirectory,
      configFilename
    );

    if (!configFilepath) {
      throw new Error(`${configFilename} not found`);
    }

    const appFilename = "_app" + (args.typescript ? ".tsx" : ".jsx");

    const searchDirectory = path.join(env.projectRootDirectory, "pages");

    const appFilepath = await findFileInDirectory(searchDirectory, appFilename);

    if (!appFilepath) {
      throw new Error(`${appFilename} not found`);
    }

    return {
      configFilepath: configFilepath,
      mainFilepath: appFilepath,
    };
  }

  throw new Error(`Unsupported toolchain: ${args.toolchain}`);
}
