import { TaskBase } from "./TaskBase.js";
import { h } from "../utils/index.js";
import { ProjectContext } from "../misc/ProjectContext.js";

export class GenerateArtifactDirectoryTask extends TaskBase {
  message: string = "Generate artifact directory";

  constructor(private context: ProjectContext) {
    super();
  }

  isEnabled(): boolean {
    return !!this.context.artifactPath;
  }

  async run(): Promise<void> {
    if (!this.context.artifactPath) {
      return;
    }

    this.updateMessage(this.message + " " + h(this.context.artifactPath.rel));

    if (this.context.fs.exists(this.context.artifactPath.abs)) {
      this.skip("Directory exists");
      return;
    }

    // todo: handle error
    this.context.fs.createDirectory(this.context.artifactPath.abs);
  }
}
