import * as vscode from "vscode";
import fsPromise from "fs/promises";
import fs from "fs";

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand(
    "translation-editor.synchronize",
    async (uri) => {
      const files = await vscode.workspace.findFiles(
        new vscode.RelativePattern(uri.fsPath, "**/*.json")
      );
      createWebviewPanel(uri.fsPath, context, files);
    }
  );

  context.subscriptions.push(disposable);
}

export function deactivate() {}

async function readAndParseJson(
  filePath: string
): Promise<Record<string, any>> {
  if (!fs.existsSync(filePath)) {
    // File doesn't exist; handle accordingly
    return {};
  }
  try {
    const content = await fsPromise.readFile(filePath, { encoding: "utf-8" });
    if (!content.trim()) {
      // Content is empty; return an empty object or handle accordingly
      return {};
    }
    return JSON.parse(content);
  } catch (e) {
    console.warn(e);
    // Do not show error message here; handle it in the caller
    throw e;
  }
}

async function createWebviewPanel(
  baseUriPath: string,
  context: vscode.ExtensionContext,
  fileUris: vscode.Uri[]
) {
  /**
   * fileName -> json data map
   */
  const uriData: Record<string, any> = {};
  const sortedFileUris = fileUris.sort();

  const result = await Promise.all(
    sortedFileUris.map(async (uri) => {
      return {
        fileName: getFileName(baseUriPath, uri),
        json: await readAndParseJson(uri.fsPath),
        uri,
      };
    })
  );

  // Filter out files that contain arrays and show a warning
  const validResults = result.filter(({ fileName, json }) => {
    if (Array.isArray(json)) {
      vscode.window.showWarningMessage(
        `Unable to load file '${fileName}'. No support for JSON arrays.`
      );
      return false;
    }
    return true;
  });

  // Update uriData and fileUris with valid files only
  validResults.forEach(({ fileName, json }) => (uriData[fileName] = json));
  fileUris = validResults.map(({ uri }) => uri);

  const panel: vscode.WebviewPanel = vscode.window.createWebviewPanel(
    "jsonFiles",
    "See translations",
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        // allow the webview to load local resources from the 'dist' directory
        vscode.Uri.joinPath(context.extensionUri, "dist"),
      ],
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

  // send initial data
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
          fileUris.forEach((fileUri) => {
            update(message.key, fileUri, message);
          });
          break;
        case "remove":
          vscode.window
            .showInformationMessage(
              `Are you sure you want to delete ${message.key.join(".")}?`,
              { modal: true },
              "OK"
            )
            .then((res) => {
              if (res === "OK") {
                fileUris.forEach((fileUri) => {
                  deleteKey(message.key, fileUri);
                });
              }
            });
          break;
      }
    },
    undefined,
    context.subscriptions
  );

  async function deleteKey(parts: string[], fileUri: vscode.Uri) {
    const filePath = fileUri.fsPath;
    const jsonData = uriData[getFileName(baseUriPath, fileUri)];

    if (!jsonData) {
      // The file was not loaded (e.g., contains an array)
      return;
    }

    let target = jsonData;

    for (let i = 0; i < parts.length - 1; i++) {
      if (target[parts[i]] === undefined) {
        // key path doesn't exist, nothing to remove
        return;
      }
      target = target[parts[i]];
    }

    const lastKey = parts[parts.length - 1];
    if (Object.prototype.hasOwnProperty.call(target, lastKey)) {
      delete target[lastKey];

      await fsPromise.writeFile(
        filePath,
        JSON.stringify(jsonData, null, 2),
        "utf-8"
      );
    }
  }

  async function update(parts: string[], fileUri: vscode.Uri, message: any) {
    const filePath = fileUri.fsPath;
    const newJsonData = uriData[getFileName(baseUriPath, fileUri)];

    if (!newJsonData) {
      // The file was not loaded (e.g., contains an array)
      return;
    }

    let target = newJsonData;
    for (let i = 0; i < parts.length; i++) {
      if (i === parts.length - 1) {
        target[parts[i]] = message.newValue;
      } else {
        if (!target[parts[i]]) {
          // ensure nested objects exist
          target[parts[i]] = {};
        }
        target = target[parts[i]];
      }
    }
    await fsPromise.writeFile(
      filePath,
      JSON.stringify(newJsonData, null, 2),
      "utf-8"
    );
  }

  // Create a single watcher for all JSON files in the folder
  const pattern = new vscode.RelativePattern(baseUriPath, "**/*.json");
  const watcher = vscode.workspace.createFileSystemWatcher(pattern);

  const maxRetries = 5;
  const retryDelay = 50; // milliseconds

  const pendingUpdates: { [key: string]: NodeJS.Timeout } = {};

  async function handleFileChange(uri: vscode.Uri, attempt = 1) {
    const fileName = getFileName(baseUriPath, uri);
    try {
      const data = await readAndParseJson(uri.fsPath);

      if (Array.isArray(data)) {
        vscode.window.showWarningMessage(
          `Unable to load file '${fileName}'. No support for JSON arrays.`
        );
        // Remove the file from uriData and fileUris if it was previously valid
        if (uriData[fileName]) {
          delete uriData[fileName];
          fileUris = fileUris.filter((file) => file.fsPath !== uri.fsPath);
          panel.webview.postMessage({ type: "json", data: uriData });
        }
        return;
      }

      // If the file was not previously loaded and is now valid, add it
      if (!uriData[fileName]) {
        uriData[fileName] = data;
        fileUris.push(uri);
      } else {
        uriData[fileName] = data;
      }

      panel.webview.postMessage({ type: "json", data: uriData });
    } catch (e) {
      // If the file is empty or invalid, retry after a short delay
      if (attempt <= maxRetries) {
        clearTimeout(pendingUpdates[uri.fsPath]);
        pendingUpdates[uri.fsPath] = setTimeout(() => {
          handleFileChange(uri, attempt + 1);
        }, retryDelay);
      } else {
        // After max retries, give up and show an error if necessary
        console.warn(
          `Failed to parse JSON file after ${maxRetries} attempts: ${uri.fsPath}`
        );
      }
    }
  }

  watcher.onDidChange(handleFileChange);
  watcher.onDidCreate(async (uri) => {
    // Handle new file creation
    await handleFileChange(uri);
  });
  watcher.onDidDelete((uri) => {
    // Handle file deletion
    const fileName = getFileName(baseUriPath, uri);
    delete uriData[fileName];
    // Remove the fileUri from the array
    fileUris = fileUris.filter((file) => file.fsPath !== uri.fsPath);
    panel.webview.postMessage({ type: "json", data: uriData });
  });

  panel.onDidDispose(() => watcher.dispose());
}

/**
 * remove the part of the path that all files share
 */
function getFileName(baseUriPath: string, uri: vscode.Uri) {
  return uri.fsPath.substring(baseUriPath.length);
}
