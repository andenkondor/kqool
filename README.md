# kqool

kqool is a command-line tool for building kql queries by interactive selection of query fragments.

## Installation

### brew

```bash
brew tap andenkondor/zapfhahn
brew install andenkondor/zapfhahn/kqool
```

### From Source

#### Prerequisites

- [zx](https://github.com/google/zx)
- [jq](https://github.com/jqlang/jq)
- [fzf](https://github.com/junegunn/fzf)

```sh
# Download the `kqool.mjs` script
zx kqool.mjs
```

## Configuration

You can configure your query fragments via config files written in yaml.
The structure can be adapted from the `.kqool.example.yaml`.

| Type   | Location                                             | Description                                                                                                                                                |
| ------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home   | `~/.kqool.yaml`                                      | Is used for all `kqool` invocations.                                                                                                                       |
| CWD    | `<cwd>/someFolder/.kqool.yaml`                       | Can be somewhere nested in the cwd where `kqool` is invoked. Allows for project specific configuration.                                                    |
| Remote | `kqool --remote-config='https://url.to.config.file'` | Allows to reference remote config files for collaboration. Url needs to provide yaml text in raw format. Multiple remote files can be used simultaneously. |

## Usage

- Run kqool without query parameters
- Hit F1 to open the help menu and get started

## Parameters

- `--remote-config`:`<string>`: Pass url for remote configuration file.

## History

kqool will save all your queries to `~/.kqool.history.kql` if the file exists. Create this file to enable automatic history saving.
