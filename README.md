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

Create a config file named `.kqool.yaml` in your home directory (`~/.kqool.yaml`) to customize query fragments.
You can get started via the provided `.kqool.example.yaml`.

## Usage

- Run kqool with out query parameters
- Hit <F1> to open the help menu and get started

## History

kqool will save all your queries to `~/.kqool.history.kql` if the file exists. Create this file to enable automatic
history saving.
