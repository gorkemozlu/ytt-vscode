# Carvel YTT Language Support

VS Code language support for [Carvel ytt](https://carvel.dev/ytt/), with a focus on safe YAML coexistence and first-class support for YTT directives, annotations, and comments.

## Highlights

- Dedicated `ytt` language mode for `.ytt.yaml` and `.ytt.yml`
- YAML injection grammar for YTT markers inside regular `.yaml` files
- Syntax highlighting for:
  - `#@` directives like `if`, `elif`, `else`, `for`, `def`, `load`, and `return`
  - `#@overlay/...`, `#@data/...`, `#@schema/...`, and `#@yaml/...` annotations
  - Inline expressions like `name: #@ data.values.name`
  - Text templates like `(@= value @)`
  - `#!` YTT comments
- YTT-aware folding for control blocks, YAML documents, and nested YAML blocks
- Quick fix to convert plain `#` comments into `#!` comments in YTT-aware files
- Snippets for common YTT authoring patterns
- Optional `ytt` CLI validation command

## Comment Syntax

YTT treats comment-like lines differently depending on the prefix:

- `#@` executes YTT directives and annotations
- `#!` is the recommended YTT comment syntax
- `#` is plain YAML comment syntax and may be undesirable in templated files

When a file is opened as `ytt`, the extension uses `#!` for the editor line comment action.

```yaml
#! this is a YTT comment
#@ load("@ytt:data", "data")

#@ if data.values.enabled:
apiVersion: v1
kind: ConfigMap
metadata:
  name: demo
data:
  owner: #@ data.values.owner
#@ else:
#! fallback branch for disabled config
data: {}
#@ end
```

## Commands

- `YTT: Preview Markers`
  Shows the YTT directives, annotations, comments, and templates detected in the active file.
- `YTT: Validate Current File`
  Runs `ytt -f <current-file>` and surfaces any CLI errors as diagnostics.

## Settings

- `yttLanguageSupport.comments.warnOnPlainYamlComments`
  Warn when plain `# ...` comments appear in YTT-aware files.
- `yttLanguageSupport.validation.mode`
  `off`, `manual`, or `onSave`.
- `yttLanguageSupport.validation.binaryPath`
  Path to the `ytt` binary used by the validation command.

## Snippets

The extension contributes snippets for:

- `ytt-if`
- `ytt-if-else`
- `ytt-for`
- `ytt-def`
- `ytt-load`
- `ytt-overlay-match`
- `ytt-data-values`
- `ytt-data-values-schema`
- `ytt-comment`

## Development

```bash
npm install
npm test
```

## Known Notes

- The extension intentionally avoids taking over all `.yaml` files.
- YTT-specific folding and diagnostics only activate for `ytt` files or YAML files that contain YTT markers.
