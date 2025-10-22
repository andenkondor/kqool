#!/usr/bin/env zx

$.verbose = false;

const KQOOL_EXECUTABLE = "kqool";
const CONFIG_FILE = `${os.homedir()}/.kqool.yaml`;
// const CONFIG_FILE = `.kqool.example.yaml`;
const HISTORY_FILE = `${os.homedir()}/.kqool.history.kql`;
async function checkForDependencies() {
  const hasJq = await which("jq", { nothrow: true });
  if (!hasJq) {
    echo(chalk.red("Please install jq to use kqool"));
    process.exit();
  }
}

async function saveAsHistory(fileContent) {
  if (!fs.existsSync(HISTORY_FILE)) {
    echo(chalk.red("Query is not saved to history."));
    echo(
      chalk.red(`Create file ${HISTORY_FILE} to automatically save queries `),
    );
    return;
  }
  fs.appendFileSync(HISTORY_FILE, `\n${fileContent}`);
}

function getConfig() {
  try {
    return YAML.parse(
      fs.readFileSync(CONFIG_FILE, {
        encoding: "utf8",
        flag: "r",
      }),
    );
  } catch (e) {
    echo(
      chalk.red(`You have no valid config file configured.
Please create a config file under ${CONFIG_FILE}.
You can take TBD as a starting point.`),
    );
    process.exit(1);
    return;
  }
}

function toBase64(input) {
  return Buffer.from(input).toString("base64");
}

const HELP_TEXT = [
  chalk.italic(chalk.red("Help")),
  "Type in any text to narrow the search.",
  "You're current query is shown in the right panel.",
  "<Enter>: Add current selection to your overall query. Resets current search text.",
  "<Ctrl-d>: Same as <Enter>, but preserves search",
  "<Ctrl-u>: Undo last selection.",
  "<Ctrl-c>: Exit kqool and print overall query",
  "<F1>: Show help section",
  "<Esc>: Hide help section",
].join("\n");

const currentTmpFiles = [];

function createTempFile(content) {
  const filePath = tmpfile("kqlinator.kql", content);
  currentTmpFiles.push(filePath);
  return filePath;
}

function replacePlaceholders(str, placeholderValues) {
  if (!str) {
    return [];
  }
  const regex = /{{(.*?)}}/g;
  const matches = [...str.matchAll(regex)];

  if (matches.length === 0) return [str];

  let combinations = [str];

  for (const match of matches) {
    const key = match[1];
    const replacements = placeholderValues[key] || [`{{${key}}}`];

    combinations = combinations.flatMap((template) =>
      replacements.map((value) => template.replace(`{{${key}}}`, value)),
    );
  }

  return combinations;
}

async function reload(internalQueryFile) {
  const currentQueryObjects = (await $`cat ${internalQueryFile}`.lines()).map(
    (q) => JSON.parse(q),
  );

  const context = {};

  currentQueryObjects
    .map((q) => q.placeholderTransformation)
    .filter((p) => Boolean(p))
    .forEach((placeholderTransformation) => {
      Object.keys(placeholderTransformation).forEach((placeholderKey) => {
        if (context[placeholderKey]) {
          context[placeholderKey].push(
            ...placeholderTransformation[placeholderKey].filter(
              (p) => !context[placeholderKey].includes(p),
            ),
          );
        } else {
          context[placeholderKey] = placeholderTransformation[placeholderKey];
        }
      });
    });

  const fragmentLines = getConfig()
    .fragments.flatMap((fragment) => {
      const queriesWithReplacement = replacePlaceholders(
        fragment.query,
        context,
      );

      return queriesWithReplacement.map(
        (q) => `${q}\t${toBase64(JSON.stringify({ ...fragment, query: q }))}`,
      );
    })
    .join("\0");

  echo(`reload(echo '${toBase64(fragmentLines)}' | base64 -d)`);
  return;
}

async function handleAddSelection(selection, internalQueryFile) {
  const addSelectionObject = await $`echo ${selection} | base64 -d`.text();
  await fs.appendFile(internalQueryFile, addSelectionObject + "\n");
  await reload(internalQueryFile);
}

async function main() {
  await checkForDependencies();
  const {
    s: internalAddSelection,
    f: internalQueryFile,
    r: internalReload,
    h: showHelp,
  } = minimist(process.argv.slice(3), {
    alias: {
      s: "internal-add-selection",
      f: "internal-query-file",
      r: "internal-reload",
      h: "help",
    },
    boolean: ["r", "h"],
  });

  if (showHelp) {
    echo("Execute kqool and hit F1 to see all possible actions.");
    return;
  }

  if (internalAddSelection && internalQueryFile) {
    handleAddSelection(internalAddSelection, internalQueryFile);
    return;
  }
  if (internalReload && internalQueryFile) {
    await reload(internalQueryFile);
    return;
  }

  const queryFile = await createTempFile();

  const fragmentLines = getConfig()
    .fragments.map((f) => `${f.query}\t${toBase64(JSON.stringify(f))}`)
    .join("\0");

  await $({
    input: fragmentLines,
  })`${[
    "fzf",
    "--border",
    "--exact",
    "--read0",
    "--gap",
    "--highlight-line",
    ...["--delimiter", "\t"],
    ...["--with-nth", "1"],
    ...["--preview", `jq -r '.query' ${queryFile}`],
    ...[
      "--bind",
      `enter:transform(${KQOOL_EXECUTABLE} --internal-add-selection={2} --internal-query-file ${queryFile})+change-query()`,
    ],
    ...[
      "--bind",
      `ctrl-d:transform(${KQOOL_EXECUTABLE} --internal-add-selection={2} --internal-query-file ${queryFile})`,
    ],
    ...[
      "--bind",
      `ctrl-u:execute-silent(sed -i "" -e "$ d" ${queryFile})+refresh-preview+transform(${KQOOL_EXECUTABLE} --internal-reload --internal-query-file ${queryFile})`,
    ],
    ...["--bind", `ctrl-c:abort`],
    ...["--bind", `f1:change-footer(${HELP_TEXT})`],
    ...["--bind", `esc:change-footer()`],
    ...[
      "--bind",
      `ctrl-w:jump,jump:transform(${KQOOL_EXECUTABLE} --internal-add-selection={2} --internal-query-file ${queryFile})+change-query()`,
    ],
    ...["--border", "rounded"],
    ...["--color", "border:#3344cb,label:#aeaeae,query:#d9d9d9"],
    ...["--color", "fg:#d0d0d0,fg+:#d0d0d0,bg:#121212,bg+:#262626"],
    ...["--color", "hl:#5f87af,hl+:#5fd7ff,info:#afaf87,marker:#87ff00"],
    ...[
      "--color",
      "prompt:#d7005f,spinner:#af5fff,pointer:#af5fff,header:#87afaf",
    ],
    ...[
      "--jump-labels",
      "1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
    ],
    ...["--marker", ">"],
    ...["--pointer", "◆"],
    ...["--preview-window", "border-rounded"],
    ...["--prompt", "> "],
    ...["--reverse"],
    ...["--scrollbar", "│"],
    ...["--separator", "─"],
  ]}`.nothrow();

  const finalQuery = await $`jq -r '.query' ${queryFile}`.text();

  if (!finalQuery) {
    echo("no query captured");
    return;
  }
  const finalQueryFile = createTempFile(finalQuery);
  echo("Your query is saved at: " + finalQueryFile);
  echo("Your query:");
  echo(chalk.bold(finalQuery));

  if (await which("pbcopy", { nothrow: true })) {
    await $`cat ${finalQueryFile} | pbcopy`;
  }

  await saveAsHistory(finalQuery);
}

await main();
