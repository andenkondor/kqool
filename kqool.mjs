#!/usr/bin/env zx

$.verbose = false;

const CONFIG_FILE = `${os.homedir()}/.kqool.yaml`;

function getConfig() {
  return YAML.parse(
    fs.readFileSync(CONFIG_FILE, { encoding: "utf8", flag: "r" }),
  );
}

function toBase64(input) {
  return Buffer.from(input).toString("base64");
}

// TODO:
const HELP_TEXT = [
  chalk.italic(chalk.red("Key bindings")),
  "ctrl-g: toggle search mode (rg <-> fzf)",
  "ctrl-n: switch column to search",
  "enter: open single or multiple in nvim (keep search open)",
  "alt-enter: open single or multiple in nvim (close skan)",
  "ctrl-s: open in IDEA (keep search open)",
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

async function handleAddSelection(selection, internalQueryFile) {
  const addSelectionObject = await $`echo ${selection} | base64 -d`.text();
  await fs.appendFile(internalQueryFile, addSelectionObject + "\n");

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

  echo(`reload(echo '${toBase64(fragmentLines)}' | base64 -d)+change-query()`);
  return;
}

async function main() {
  const { s: internalAddSelection, f: internalQueryFile } = minimist(
    process.argv.slice(3),
    {
      alias: {
        s: "internal-add-selection",
        f: "internal-query-file",
      },
    },
  );

  if (internalAddSelection && internalQueryFile) {
    handleAddSelection(internalAddSelection, internalQueryFile);
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
    "--multi",
    "--read0",
    "--gap",
    "--highlight-line",
    ...["--delimiter", "\t"],
    ...["--with-nth", "1"],
    ...["--preview", `jq -r '.query' ${queryFile}`],

    ...[
      "--bind",
      `enter:transform(./kqool.mjs --internal-add-selection={2} --internal-query-file ${queryFile})`,
    ],
    ...[
      "--bind",
      `ctrl-u:execute-silent(sed -i "" -e "$ d" ${queryFile})+refresh-preview`,
    ],
    ...["--bind", `ctrl-c:abort`],
  ]}`.nothrow();

  const finalQuery = await $`jq -r '.query' ${queryFile}`.text();
  const finalQueryFile = createTempFile(finalQuery);
  echo("Your query is saved at: " + finalQueryFile);
  echo("Your query:");
  echo(chalk.bold(finalQuery));

  await $`cat ${finalQueryFile} | pbcopy`;
}

await main();
