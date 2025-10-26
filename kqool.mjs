#!/usr/bin/env zx

$.verbose = false;

const KQOOL_EXECUTABLE = "kqool";
const LOCAL_CONFIGS = glob.sync([`{${os.homedir()},**}/.kqool.yaml`]);
const HISTORY_FILE = `${os.homedir()}/.kqool.history.kql`;

const NTH = {
  QUERY_LINE: "1",
  QUERY_OBJECT: "2",
};

async function saveAsHistory(fileContent) {
  if (!fs.existsSync(HISTORY_FILE)) {
    echo(
      chalk.red(
        `Query is not saved to history.
Create file ${HISTORY_FILE} to automatically save queries `,
      ),
    );
    return;
  }
  fs.appendFileSync(
    HISTORY_FILE,
    `
// ${new Date().toISOString()}
${fileContent}`,
  );
}

function mergeConfigs(configs) {
  return configs.reduce(
    (prev, current) => {
      const defaultPlaceholderTransformation =
        prev?.defaultPlaceholderTransformation ?? {};
      Object.entries(current?.defaultPlaceholderTransformation ?? {}).forEach(
        ([key, value]) => {
          defaultPlaceholderTransformation[key] = [
            ...new Set([
              ...(defaultPlaceholderTransformation?.[key] || []),
              ...value,
            ]),
          ];
        },
      );

      return {
        defaultPlaceholderTransformation,
        fragments: [...prev.fragments, ...current.fragments],
      };
    },
    {
      defaultPlaceholderTransformation: {},
      fragments: [],
    },
  );
}

async function getConfig(remoteConfigs) {
  const configs = [
    ...LOCAL_CONFIGS.map((f) =>
      YAML.parse(
        fs.readFileSync(f, {
          encoding: "utf8",
          flag: "r",
        }),
      ),
    ),
    ...(
      await Promise.all(remoteConfigs.map((r) => $`curl -s ${r}`.text()))
    ).map((r) => YAML.parse(r)),
  ];

  const overallConfig = mergeConfigs(configs);

  if (!overallConfig.fragments.length) {
    chalk.red(`No fragments found.
Please specify config at ${defaultConfigFile}`);
    process.exit();
  }

  return overallConfig;
}

function toBase64(input) {
  return Buffer.from(input).toString("base64");
}

const HELP_TEXT = [
  chalk.italic.red("Help"),
  "Type in any text to narrow the search.",
  "You're current query is shown in the right panel.",
  "<Enter>: Add current selection to your overall query. Resets current search text.",
  "<Ctrl-d>: Same as <Enter>, but preserves search",
  "<Ctrl-u>: Undo last selection.",
  "<Ctrl-c>: Exit kqool and print overall query",
  "<Ctrl-w>: Show jump labels",
  "<F1>: Show help section",
  "<Esc>: Hide help section",
].join("\n");

const currentTmpFiles = [];

function createTempFile(content) {
  const filePath = tmpfile("kqool", JSON.stringify(content));
  currentTmpFiles.push(filePath);
  return filePath;
}

function replacePlaceholders(fragment, placeholderValues) {
  if (!fragment) {
    return [];
  }
  const regex = /{{(.*?)}}/g;
  const matches = [...fragment.matchAll(regex)];

  if (matches.length === 0) return [fragment];

  let combinations = [fragment];

  for (const match of matches) {
    const key = match[1];
    const replacements = placeholderValues[key] || [`{{${key}}}`];

    combinations = combinations.flatMap((template) =>
      replacements.map((value) => template.replace(`{{${key}}}`, value)),
    );
  }

  return combinations;
}

async function reload(stateFile) {
  const { config, selection } = JSON.parse(
    fs.readFileSync(stateFile, {
      encoding: "utf8",
      flag: "r",
    }),
  );

  const placeHolderTransformations = mergeConfigs([
    config,
    ...selection.map((s) => ({
      fragments: [],
      defaultPlaceholderTransformation: s.placeholderTransformation,
    })),
  ]).defaultPlaceholderTransformation;

  const fragmentLines = config.fragments
    .flatMap((fragment) => {
      const queriesWithReplacement = replacePlaceholders(
        fragment.query,
        placeHolderTransformations,
      );

      return queriesWithReplacement.map(
        (q) => `${q}\t${toBase64(JSON.stringify({ ...fragment, query: q }))}`,
      );
    })
    .join("\0");

  echo(`reload(echo '${toBase64(fragmentLines)}' | base64 -d)`);
  return;
}

async function handleAddSelection(encodedSelection, stateFile) {
  const decodedSelection = await $`echo ${encodedSelection} | base64 -d`.json();
  const state = JSON.parse(
    fs.readFileSync(stateFile, {
      encoding: "utf8",
      flag: "r",
    }),
  );

  const newState = {
    ...state,
    selection: [...state.selection, decodedSelection],
  };
  fs.writeFileSync(stateFile, JSON.stringify(newState));
  await reload(stateFile);
}

async function main() {
  const {
    s: internalAddSelection,
    f: internalStateFile,
    l: internalReload,
    r: remoteConfig,
    h: showHelp,
  } = minimist(process.argv.slice(3), {
    alias: {
      s: "internal-add-selection",
      f: "internal-state-file",
      l: "internal-reload",
      r: "remote-config",
      h: "help",
    },
    boolean: ["l", "h"],
  });

  const remoteConfigs = remoteConfig
    ? Array.isArray(remoteConfig)
      ? remoteConfig
      : [remoteConfig]
    : [];

  if (showHelp) {
    echo("Execute kqool and hit F1 to see all possible actions.");
    return;
  }

  if (internalAddSelection && internalStateFile) {
    await handleAddSelection(internalAddSelection, internalStateFile);
    return;
  }

  if (internalReload && internalStateFile) {
    await reload(internalStateFile);
    return;
  }

  const stateFile = await createTempFile({
    config: await getConfig(remoteConfigs),
    selection: [],
  });

  echo(stateFile);

  $.spawnSync(
    "fzf",
    [
      // flags
      "--border",
      "--gap",
      "--highlight-line",
      "--read0",
      // simple
      ...["--border", "rounded"],
      ...["--delimiter", "\t"],
      ...["--marker", ">"],
      ...["--pointer", "◆"],
      ...["--preview", `jq -r '.selection[].query' ${stateFile}`],
      ...["--preview-window", "border-rounded"],
      ...["--prompt", "> "],
      ...["--reverse"],
      ...["--scrollbar", "│"],
      ...["--separator", "─"],
      ...["--with-nth", NTH.QUERY_LINE],
      ...[
        "--jump-labels",
        "1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
      ],
      // bindings
      ...[
        `ctrl-c:abort`,
        `ctrl-d:transform(${KQOOL_EXECUTABLE} --internal-add-selection={${NTH.QUERY_OBJECT}} --internal-state-file ${stateFile})`,
        `ctrl-u:execute-silent(sed -i "" -e "$ d" ${stateFile})+refresh-preview+transform(${KQOOL_EXECUTABLE} --internal-reload --internal-state-file ${stateFile})`,
        "ctrl-w:" +
          [
            `jump,jump:transform(${KQOOL_EXECUTABLE} --internal-add-selection={${NTH.QUERY_OBJECT}} --internal-state-file ${stateFile})`,
            "change-query()",
          ].join("+"),
        "enter:" +
          [
            `transform(${KQOOL_EXECUTABLE} --internal-add-selection={${NTH.QUERY_OBJECT}} --internal-state-file ${stateFile})`,
            "change-query()",
          ].join("+"),
        `esc:change-footer()`,
        `f1:change-footer(${HELP_TEXT})`,
        `start:transform(${KQOOL_EXECUTABLE} --internal-reload --internal-state-file ${stateFile})`,
      ].flatMap((s) => ["--bind", s]),
      // colors
      ...[
        "bg+:#7f1313",
        "bg:#121212",
        "border:#3344cb",
        "fg+:#d0d0d0",
        "fg:#d0d0d0",
        "gutter:#121212",
        "header:#87afaf",
        "hl+:#5fd7ff",
        "hl:#5f87af",
        "info:#afaf87",
        "label:#aeaeae",
        "marker:#87ff00",
        "pointer:#af5fff",
        "prompt:#d7005f",
        "query:#d9d9d9",
        "spinner:#af5fff",
      ].flatMap((c) => ["--color", c]),
    ],
    {
      encoding: "utf-8",
    },
  );

  const finalQuery = await $`jq -r '.selection[].query' ${stateFile}`.text();

  if (!finalQuery) {
    echo("no query captured");
    return;
  }
  const finalQueryFile = createTempFile(finalQuery);
  echo("Your query is saved at: " + finalQueryFile);
  echo("Your query:");
  echo(chalk.bold(finalQuery));

  // TODO: enable clipboard for other OS
  if (await which("pbcopy", { nothrow: true })) {
    await $`cat ${finalQueryFile} | pbcopy`;
  }

  await saveAsHistory(finalQuery);
}

await main();
