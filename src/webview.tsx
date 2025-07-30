import React, { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import css from "./styles.css";

interface VsCodeApi {
  postMessage(message: any): void;
  setState(state: any): void;
  getState(): any;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

type JSONData = { [key: string]: any };

const App = () => {
  const [jsonData, setJsonData] = useState<JSONData>({});

  const handleEdit = (
    command: string,
    path: string[],
    fileIndex: number,
    newValue: string
  ) => {
    vscode.postMessage({
      command,
      key: path,
      fileIndex: fileIndex,
      newValue: newValue,
    });
  };

  useEffect(() => {
    // handle messages from the extension
    const messageHandler = (event: MessageEvent) => {
      const message = event.data;
      switch (message.type) {
        case "json":
          setJsonData(message.data);
          break;
      }
    };

    window.addEventListener("message", messageHandler);

    return () => {
      window.removeEventListener("message", messageHandler);
    };
  }, []);

  return (
    <div>
      <Table data={jsonData} handleEdit={handleEdit} />
    </div>
  );
};

export default App;

const style = document.createElement("style");
style.textContent = css;
document.head.appendChild(style);
const container = document.getElementById("root");
const root = ReactDOM.createRoot(container);
root.render(React.createElement(App));

const Table = ({
  data,
  handleEdit,
}: {
  data: JSONData;
  handleEdit: (
    command: string,
    path: string[],
    fileIndex: number,
    newValue: string
  ) => void;
}) => {
  const fileNames = [];
  const dataArray = [];

  for (const key of Object.keys(data)) {
    fileNames.push(key);
    dataArray.push(data[key]);
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Key</th>
          {fileNames.map((name, index) => (
            <th key={index}>{name}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {generateTableRows(dataArray, 0, [], fileNames, handleEdit)}
      </tbody>
    </table>
  );
};

function generateTableRows(
  dataArray: Array<JSONData>,
  depth: number,
  parentPath: string[],
  fileNames: string[],
  handleEdit: (
    command: string,
    path: string[],
    fileIndex: number,
    newValue: string
  ) => void,
  hasMissingValue?: (filesMissingValue: Set<number>) => void
): React.ReactNode {
  const allKeys = new Set<string>();
  /**
   * column index of the files that are missing values
   */
  const missingValues: Set<number> = new Set();

  dataArray.forEach((obj) => {
    Object.keys(obj).forEach((key) => allKeys.add(key));
  });

  const nestIndentation = 5 + depth * 20;
  const rows: React.ReactNode[] = [];

  const handleRemove = (e: React.MouseEvent, path: string[]) => {
    // prevent click from expanding row if it's a nested object
    e.stopPropagation();
    e.preventDefault();
    vscode.postMessage({
      command: "remove",
      key: path,
    });
  };

  allKeys.forEach((key) => {
    const currentPath = [...parentPath, key];
    const joinedPath = currentPath.join("-");
    const isNested = dataArray.some(
      (obj) =>
        typeof obj[key] === "object" &&
        obj[key] !== null &&
        !Array.isArray(obj[key])
    );

    if (isNested) {
      const nestedDataArray = dataArray.map((obj) => obj[key] || {});

      let isMissing: Set<number>;

      const tableRows = generateTableRows(
        nestedDataArray,
        depth + 1,
        currentPath,
        fileNames,
        handleEdit,
        (isMis: Set<number>) => (isMissing = isMis)
      );

      isMissing.forEach((m) => missingValues.add(m));

      rows.push(
        <React.Fragment key={joinedPath}>
          <tr
            id={`${joinedPath}-header`}
            style={{ cursor: "pointer" }}
            onClick={() => toggleVisibility(joinedPath)}
          >
            <td>
              <div
                style={{
                  paddingLeft: nestIndentation,
                  cursor: "pointer",
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                {key}
                <button
                  className="remove-button"
                  onClick={(e) => handleRemove(e, currentPath)}
                >
                  -
                </button>
              </div>
            </td>
            {fileNames.map((_, index) => {
              if (isMissing.has(index)) {
                return <td key={index} className="missing-value"></td>;
              }

              return <td key={index}></td>;
            })}
          </tr>
          <tr id={joinedPath} className="collapse" style={{ display: "none" }}>
            <td colSpan={fileNames.length + 1} style={{ padding: 0 }}>
              <table
                style={{
                  borderSpacing: 0,
                  width: "100%",
                  borderCollapse: "collapse",
                  tableLayout: "fixed",
                }}
              >
                <tbody>{tableRows}</tbody>
              </table>
            </td>
          </tr>
        </React.Fragment>
      );
    } else {
      const rowCells = dataArray.map((obj, index) => {
        let value = obj[key];
        // throw error if value isn't a string
        if (!(typeof value === "string") && !(value === undefined)) {
          let joinedPath =
            parentPath.length > 0 ? `${parentPath.join(".")}.` : "";

          vscode.postMessage({
            command: "invalidData",
            newValue: `${fileNames[index]}: ${joinedPath}${key}: ${
              value instanceof Array ? "Array" : typeof value
            }`,
          });
          return;
        }
        const safeContent = (value ?? "").toString();
        const cellClass = (value ?? "").trim() === "" ? "missing-value" : "";

        if (cellClass) {
          // flag this column as having a missing value
          missingValues.add(index);
        }

        return (
          <td
            key={index}
            className={cellClass}
            contentEditable
            suppressContentEditableWarning
            onFocus={(e) => {
              e.currentTarget.setAttribute(
                "data-original",
                e.currentTarget.innerText
              );
            }}
            onBlur={(e) => {
              const originalValue =
                e.currentTarget.getAttribute("data-original") || "";
              const newValue = e.currentTarget.innerText;
              if (newValue !== originalValue) {
                handleEdit("edit", currentPath, index, newValue);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                (e.target as HTMLInputElement).blur();
              }
            }}
          >
            {safeContent}
          </td>
        );
      });

      rows.push(
        <tr key={joinedPath}>
          <td>
            <div
              style={{
                paddingLeft: nestIndentation,
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              {key}
              <button
                className="remove-button"
                onClick={(e) => handleRemove(e, currentPath)}
              >
                -
              </button>
            </div>
          </td>
          {rowCells}
        </tr>
      );
    }
  });

  const handleAdd = (key: string, value: any) => {
    if (allKeys.has(key)) {
      vscode.postMessage({
        command: "showWarning",
        newValue: "Key already exists",
      });
      return false;
    }

    vscode.postMessage({
      command: "add",
      key: [...parentPath, key],
      newValue: value,
    });
    return true;
  };

  rows.push(
    <AddNewKey
      key={parentPath.join("-") + "-addKey"}
      parentPath={parentPath}
      fileCount={dataArray.length}
      nestIndentation={nestIndentation}
      handleAdd={handleAdd}
    />
  );

  hasMissingValue?.(missingValues);

  return rows;
}

enum EditMode {
  NONE = "none",
  FIELD = "field",
  GROUP = "group",
}

function AddNewKey(props: {
  parentPath: string[];
  nestIndentation: number;
  fileCount: number;
  handleAdd: (key: string, value: any) => boolean;
}) {
  const [editMode, setEditMode] = useState<EditMode>(EditMode.NONE);
  const [hasError, setHasError] = useState(false);
  const contentEditableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // focus the contentEditable div if the edit mode is FIELD or GROUP
    if (editMode !== EditMode.NONE && contentEditableRef.current) {
      contentEditableRef.current.focus();
    }
  }, [editMode]);

  if (editMode === EditMode.NONE) {
    return (
      <tr>
        <td>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "5px",
              paddingLeft: props.nestIndentation,
            }}
          >
            Add
            <button onClick={() => setEditMode(EditMode.FIELD)}>Field</button>
            <button onClick={() => setEditMode(EditMode.GROUP)}>Group</button>
          </div>
        </td>
        {[...Array(props.fileCount)].map((_, i) => (
          <td key={i}></td>
        ))}
      </tr>
    );
  }

  const submit = () => {
    if (
      props.handleAdd(
        contentEditableRef.current.innerText,
        editMode === EditMode.GROUP ? {} : ""
      )
    ) {
      setEditMode(EditMode.NONE);
    } else {
      setHasError(true);
    }
  };

  const cancel = () => {
    setHasError(false);
    setEditMode(EditMode.NONE);
  };

  return (
    <tr>
      <td style={{ padding: "0" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          <div
            contentEditable
            className={hasError ? "has-error" : ""}
            style={{ flexGrow: 1, lineHeight: "25px" }}
            ref={contentEditableRef}
            onInput={() => setHasError(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
              if (e.key === "Escape") {
                cancel();
              }
            }}
          ></div>
          <div
            contentEditable={false}
            style={{ display: "flex", gap: "5px", padding: "5px" }}
          >
            <button onClick={cancel}>✕</button>
            <button onClick={submit}> &#x2713;</button>
          </div>
        </div>
      </td>
      {[...Array(props.fileCount)].map((_, i) => (
        <td key={i}></td>
      ))}
    </tr>
  );
}

function toggleVisibility(id: string) {
  const element = document.getElementById(id);
  if (element) {
    element.style.display =
      element.style.display === "none" ? "table-row" : "none";
  }
}
