#!/usr/bin/env node

import path, { dirname } from "path";
import { TaskRunner } from "./TaskRunner.js";
import { AddGraphQlSchemaFileTask } from "./tasks/AddGraphQlSchemaFileTask.js";
import chalk from "chalk";
import { AddRelayConfigurationTask } from "./tasks/AddRelayConfigurationTask.js";
import { ToolChain, EnvArguments, ProjectSettings } from "./types.js";
import { InstallNpmPackagesTask } from "./tasks/InstallNpmPackagesTask.js";
import { AddRelayPluginConfigurationTask } from "./tasks/AddRelayPluginConfigurationTask.js";
import { AddRelayEnvironmentTask } from "./tasks/AddRelayEnvironmentTask.js";
import {
  traverseUpToFindFile,
  printError,
  getRelayDevDependencies,
} from "./helpers.js";
import { exit } from "process";
import {
  ARTIFACT_DIR_ARG,
  BABEL_RELAY_PACKAGE,
  PACKAGE_FILE,
  SCHEMA_FILE_ARG,
  SRC_DIR_ARG,
  VITE_RELAY_PACKAGE,
} from "./consts.js";
import { fileURLToPath } from "url";
import { getCliArguments, promptForMissingCliArguments } from "./cli.js";
import {
  hasUnsavedGitChanges,
  isValidArtifactDirectory,
  isValidSchemaPath,
  isValidSrcDirectory,
} from "./validation.js";

// INIT ENVIRONMENT

const distDirectory = dirname(fileURLToPath(import.meta.url));
const ownPackageDirectory = path.join(distDirectory, "..");
const workingDirectory = process.cwd();
const packageJsonFile = await traverseUpToFindFile(
  workingDirectory,
  PACKAGE_FILE
);

if (!packageJsonFile) {
  printError(
    `Could not find a ${chalk.cyan.bold(PACKAGE_FILE)} in the ${chalk.cyan.bold(
      workingDirectory
    )} directory.`
  );
  exit(1);
}

const projectRootDirectory = path.dirname(packageJsonFile);

const envArguments: EnvArguments = {
  workingDirectory,
  ownPackageDirectory,
  packageJsonFile,
  projectRootDirectory,
};

// GET ARGUMENTS

// todo: handle errors
const cliArguments = await getCliArguments(envArguments);

if (!cliArguments.ignoreGitChanges) {
  const hasUnsavedChanges = await hasUnsavedGitChanges(
    envArguments.projectRootDirectory
  );

  if (hasUnsavedChanges) {
    printError(
      `Please commit or discard all changes in the ${chalk.cyan.bold(
        envArguments.projectRootDirectory
      )} directory before continuing.`
    );
    exit(1);
  }
}

const completeArguments = await promptForMissingCliArguments(
  cliArguments,
  envArguments
);

// VALIDATE ARGUMENTS

const schemaPathValid = isValidSchemaPath(completeArguments.schemaFilePath);

if (schemaPathValid !== true) {
  printError(
    `Invalid ${SCHEMA_FILE_ARG} specified: ${
      completeArguments.schemaFilePath
    } ${chalk.dim(schemaPathValid)}`
  );
  exit(1);
}

const srcDirValid = isValidSrcDirectory(completeArguments.srcDirectoryPath);

if (srcDirValid !== true) {
  printError(
    `Invalid ${SRC_DIR_ARG}  specified:  ${
      completeArguments.srcDirectoryPath
    } ${chalk.dim(srcDirValid)}`
  );
  exit(1);
}

const artifactDirValid = isValidArtifactDirectory(
  completeArguments.artifactDirectoryPath
);

if (artifactDirValid !== true) {
  printError(
    `Invalid ${ARTIFACT_DIR_ARG} specified:  ${
      completeArguments.artifactDirectoryPath
    } ${chalk.dim(artifactDirValid)}`
  );
  exit(1);
}

// EXECUTE TASKS

const settings: ProjectSettings = {
  ...envArguments,
  ...completeArguments,
};

const dependencies = ["react-relay"];
const devDependencies = getRelayDevDependencies(
  settings.toolChain,
  settings.useTypescript
);

const runner = new TaskRunner([
  {
    title: `Add Relay dependencies: ${dependencies
      .map((d) => chalk.cyan.bold(d))
      .join(" ")}`,
    task: new InstallNpmPackagesTask(dependencies, false, settings),
  },
  {
    title: `Add Relay devDependencies: ${devDependencies
      .map((d) => chalk.cyan.bold(d))
      .join(" ")}`,
    task: new InstallNpmPackagesTask(devDependencies, true, settings),
  },
  {
    title: "Add Relay configuration to package.json",
    task: new AddRelayConfigurationTask(settings),
  },
  {
    title: "Add Relay plugin configuration",
    task: new AddRelayPluginConfigurationTask(settings),
  },
  {
    title: "Add Relay environment",
    task: new AddRelayEnvironmentTask(settings),
  },
  {
    title: `Generate GraphQL schema file (${chalk.cyan.bold(
      settings.schemaFilePath
    )})`,
    task: new AddGraphQlSchemaFileTask(settings),
  },
]);

try {
  await runner.run();
} catch {
  console.log();
  printError("Some of the tasks failed unexpectedly.");
  exit(1);

  // todo: if tasks fail, display ways to resovle the tasks manually
}

// DISPLAY RESULT

console.log();

console.log(chalk.yellow.bold("Next steps:"));

console.log(
  `1. Replace ${chalk.cyan.bold(
    settings.schemaFilePath
  )} with your own GraphQL schema file.`
);

// todo: get correct path to file
console.log(
  `2. Replace the value of the ${chalk.cyan.bold(
    "HOST"
  )} variable in the RelayEnvironment.ts file.`
);

console.log();
