import { TaskBase } from "./TaskBase.js";
import { h, prettifyCode } from "../utils/index.js";
import { ProjectContext } from "../misc/ProjectContext.js";
import { EOL } from "os";

export const HTTP_ENDPOINT = "HTTP_ENDPOINT";
export const WEBSOCKET_ENDPOINT = "WEBSOCKET_ENDPOINT";

export class GenerateRelayEnvironmentTask extends TaskBase {
  message: string = "Generate Relay environment";

  constructor(private context: ProjectContext) {
    super();
  }

  isEnabled(): boolean {
    return true;
  }

  async run(): Promise<void> {
    await this.addRelayEnvironmentFile();
  }

  // todo: this could maybe be simplified by also using the AST.
  //       this would also enable us to update an existing configuration.
  private async addRelayEnvironmentFile() {
    this.updateMessage(this.message + " " + h(this.context.relayEnvFile.rel));

    if (this.context.fs.exists(this.context.relayEnvFile.abs)) {
      this.skip("File exists");
      return;
    }

    const b = new CodeBuilder();

    // Add imports
    const relayRuntimeImports: string[] = [
      "Environment",
      "Network",
      "RecordSource",
      "Store",
    ];

    if (this.context.args.subscriptions) {
      relayRuntimeImports.push("Observable");
    }

    if (this.context.args.typescript) {
      relayRuntimeImports.push("FetchFunction");

      if (this.context.args.subscriptions) {
        relayRuntimeImports.push("SubscribeFunction");
      }

      if (this.context.is("next")) {
        // prettier-ignore
        b.addLine(`import type { RecordMap } from "relay-runtime/lib/store/RelayStoreTypes";`)
      }
    }

    // prettier-ignore
    b.addLine(`import { ${relayRuntimeImports.join(", ")} } from "relay-runtime";`)

    if (this.context.args.subscriptions) {
      b.addLine(`import { createClient } from "graphql-ws";`);
    }

    b.addLine();

    // Add configurations
    b.addLine(`const ${HTTP_ENDPOINT} = "http://localhost:5000/graphql";`);

    if (this.context.args.subscriptions) {
      b.addLine(`const ${WEBSOCKET_ENDPOINT} = "ws://localhost:5000/graphql";`);
    }

    b.addLine();

    // Add fetchFn
    let fetchFn = `const fetchFn: FetchFunction = async (request, variables) => {
      const resp = await fetch(${HTTP_ENDPOINT}, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          // <-- Additional headers like 'Authorization' would go here
        },
        body: JSON.stringify({
          query: request.text, // <-- The GraphQL document composed by Relay
          variables,
        }),
      });

      return await resp.json();
    };`;

    if (!this.context.args.typescript) {
      // Remove Typescript type
      fetchFn = fetchFn.replace("fetchFn: FetchFunction", "fetchFn");
    }

    b.addLine(fetchFn);

    b.addLine();

    // Add subscribeFn
    if (this.context.args.subscriptions) {
      b.addLine(`const subscriptionsClient = createClient({
        url: ${WEBSOCKET_ENDPOINT},
      });`);

      b.addLine();

      if (this.context.args.typescript) {
        b.addLine(`const subscribeFn: SubscribeFunction = (request, variables) => {
          // To understand why we return Observable<any>,
          // please see: https://github.com/enisdenjo/graphql-ws/issues/316#issuecomment-1047605774
          return Observable.create<any>((sink) => {
            if (!request.text) {
              return sink.error(new Error("Operation text cannot be empty"));
            }

            return subscriptionsClient.subscribe(
              {
                operationName: request.name,
                query: request.text,
                variables,
              },
              sink
            );
          });
        };`);
      } else {
        b.addLine(`const subscribeFn = (request, variables) => {
          return Observable.create((sink) => {
            if (!request.text) {
              return sink.error(new Error("Operation text cannot be empty"));
            }

            return subscriptionsClient.subscribe(
              {
                operationName: request.name,
                query: request.text,
                variables,
              },
              sink
            );
          });
        };`);
      }
    }

    b.addLine();

    // Create environment
    let createEnv = `function createRelayEnvironment() {
      return new Environment({
        network: Network.create(fetchFn),
        store: new Store(new RecordSource()),
      });
    }`;

    if (this.context.args.subscriptions) {
      createEnv = createEnv.replace("fetchFn", "fetchFn, subscribeFn");
    }

    b.addLine(createEnv);

    b.addLine();

    // Export environment
    if (this.context.is("next")) {
      let initEnv = `let relayEnvironment: Environment | undefined;

        export function initRelayEnvironment(initialRecords?: RecordMap) {
          const environment = relayEnvironment ?? createRelayEnvironment();

          // If your page has Next.js data fetching methods that use Relay,
          // the initial records will get hydrated here.
          if (initialRecords) {
            environment.getStore().publish(new RecordSource(initialRecords));
          }

          // For SSG and SSR always create a new Relay environment.
          if (typeof window === "undefined") {
            return environment;
          }

          // Create the Relay environment once in the client
          // and then reuse it.
          if (!relayEnvironment) {
            relayEnvironment = environment;
          }

          return relayEnvironment;
        }`;

      if (!this.context.args.typescript) {
        // Remove Typescript type
        initEnv = initEnv.replace(
          "initialRecords?: RecordMap",
          "initialRecords"
        );

        initEnv = initEnv.replace(": Environment | undefined", "");
      }

      b.addLine(initEnv);
    } else {
      b.addLine(`export const RelayEnvironment = createRelayEnvironment();`);
    }

    const prettifiedCode = prettifyCode(b.code);

    // todo: handle error
    console.log("create directory", this.context.relayEnvFile.parentDirectory);
    this.context.fs.createDirectory(this.context.relayEnvFile.parentDirectory);

    // todo: handle error
    console.log("write to file", this.context.relayEnvFile.abs);
    await this.context.fs.writeToFile(
      this.context.relayEnvFile.abs,
      prettifiedCode
    );
  }
}

class CodeBuilder {
  private _code: string = "";

  get code() {
    return this._code;
  }

  addLine(line?: string) {
    this._code += (line || "") + EOL;
  }
}
