var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode = __toESM(require("vscode"));
var import_promises = __toESM(require("fs/promises"));
var import_fs = __toESM(require("fs"));
function activate(context) {
  const disposable = vscode.commands.registerCommand(
    "json-synchronizer.synchronize",
    async (uri) => {
      const files = await vscode.workspace.findFiles(
        new vscode.RelativePattern(uri.fsPath, "**/*.json")
      );
      createWebviewPanel(uri.fsPath, context, files);
    }
  );
  context.subscriptions.push(disposable);
}
function deactivate() {
}
async function readAndParseJson(filePath) {
  if (!import_fs.default.existsSync(filePath)) {
    return {};
  }
  try {
    const content = await import_promises.default.readFile(filePath, { encoding: "utf-8" });
    if (!content.trim()) {
      return {};
    }
    return JSON.parse(content);
  } catch (e) {
    console.warn(e);
    throw e;
  }
}
async function createWebviewPanel(baseUriPath, context, fileUris) {
  const uriData = {};
  console.log("1", fileUris);
  const sortedFileUris = fileUris.sort();
  console.log("2", sortedFileUris);
  const result = await Promise.all(
    sortedFileUris.map(async (uri) => {
      return {
        fileName: getFileName(baseUriPath, uri),
        json: await readAndParseJson(uri.fsPath),
        uri
      };
    })
  );
  const validResults = result.filter(({ fileName, json }) => {
    if (Array.isArray(json)) {
      vscode.window.showWarningMessage(
        `Unable to load file '${fileName}'. No support for JSON arrays.`
      );
      return false;
    }
    return true;
  });
  validResults.forEach(({ fileName, json }) => uriData[fileName] = json);
  fileUris = validResults.map(({ uri }) => uri);
  const panel = vscode.window.createWebviewPanel(
    "jsonFiles",
    "Synchronize JSON",
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        // allow the webview to load local resources from the 'dist' directory
        vscode.Uri.joinPath(context.extensionUri, "dist")
      ]
    }
  );
  const scriptUri = panel.webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, "dist", "webview.js")
  );
  panel.webview.html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" >
    </head>
    <body>
      <div id="root"></div>
      <script src="${scriptUri}"></script>
    </body>
    </html>
  `;
  panel.webview.postMessage({ type: "json", data: uriData });
  panel.webview.onDidReceiveMessage(
    async (message) => {
      switch (message.command) {
        case "invalidData":
          vscode.window.showErrorMessage(
            `
              Invalid data: This extension only supports files containing a single JSON object with nested objects and string values. 
            `,
            { modal: true, detail: message.newValue }
          );
          panel.dispose();
          break;
        case "showWarning":
          vscode.window.showWarningMessage(message.newValue);
          break;
        case "edit":
          const fileUri = fileUris[message.fileIndex];
          update(message.key, fileUri, message);
          break;
        case "add":
          fileUris.forEach((fileUri2) => {
            update(message.key, fileUri2, message);
          });
          break;
        case "remove":
          vscode.window.showInformationMessage(
            `Are you sure you want to delete ${message.key.join(".")}?`,
            { modal: true },
            "OK"
          ).then((res) => {
            if (res === "OK") {
              fileUris.forEach((fileUri2) => {
                deleteKey(message.key, fileUri2);
              });
            }
          });
          break;
      }
    },
    void 0,
    context.subscriptions
  );
  async function deleteKey(parts, fileUri) {
    const filePath = fileUri.fsPath;
    const jsonData = uriData[getFileName(baseUriPath, fileUri)];
    if (!jsonData) {
      return;
    }
    let target = jsonData;
    for (let i = 0; i < parts.length - 1; i++) {
      if (target[parts[i]] === void 0) {
        return;
      }
      target = target[parts[i]];
    }
    const lastKey = parts[parts.length - 1];
    if (Object.prototype.hasOwnProperty.call(target, lastKey)) {
      delete target[lastKey];
      await import_promises.default.writeFile(
        filePath,
        JSON.stringify(jsonData, null, 2),
        "utf-8"
      );
    }
  }
  async function update(parts, fileUri, message) {
    const filePath = fileUri.fsPath;
    const newJsonData = uriData[getFileName(baseUriPath, fileUri)];
    if (!newJsonData) {
      return;
    }
    let target = newJsonData;
    for (let i = 0; i < parts.length; i++) {
      if (i === parts.length - 1) {
        target[parts[i]] = message.newValue;
      } else {
        if (!target[parts[i]]) {
          target[parts[i]] = {};
        }
        target = target[parts[i]];
      }
    }
    await import_promises.default.writeFile(
      filePath,
      JSON.stringify(newJsonData, null, 2),
      "utf-8"
    );
  }
  const pattern = new vscode.RelativePattern(baseUriPath, "**/*.json");
  const watcher = vscode.workspace.createFileSystemWatcher(pattern);
  const maxRetries = 5;
  const retryDelay = 50;
  const pendingUpdates = {};
  async function handleFileChange(uri, attempt = 1) {
    const fileName = getFileName(baseUriPath, uri);
    try {
      const data = await readAndParseJson(uri.fsPath);
      if (Array.isArray(data)) {
        vscode.window.showWarningMessage(
          `Unable to load file '${fileName}'. No support for JSON arrays.`
        );
        if (uriData[fileName]) {
          delete uriData[fileName];
          fileUris = fileUris.filter((file) => file.fsPath !== uri.fsPath);
          panel.webview.postMessage({ type: "json", data: uriData });
        }
        return;
      }
      if (!uriData[fileName]) {
        uriData[fileName] = data;
        fileUris.push(uri);
      } else {
        uriData[fileName] = data;
      }
      panel.webview.postMessage({ type: "json", data: uriData });
    } catch (e) {
      if (attempt <= maxRetries) {
        clearTimeout(pendingUpdates[uri.fsPath]);
        pendingUpdates[uri.fsPath] = setTimeout(() => {
          handleFileChange(uri, attempt + 1);
        }, retryDelay);
      } else {
        console.warn(
          `Failed to parse JSON file after ${maxRetries} attempts: ${uri.fsPath}`
        );
      }
    }
  }
  watcher.onDidChange(handleFileChange);
  watcher.onDidCreate(async (uri) => {
    await handleFileChange(uri);
  });
  watcher.onDidDelete((uri) => {
    const fileName = getFileName(baseUriPath, uri);
    delete uriData[fileName];
    fileUris = fileUris.filter((file) => file.fsPath !== uri.fsPath);
    panel.webview.postMessage({ type: "json", data: uriData });
  });
  panel.onDidDispose(() => watcher.dispose());
}
function getFileName(baseUriPath, uri) {
  return uri.fsPath.substring(baseUriPath.length);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
