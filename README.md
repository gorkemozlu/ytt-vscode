# Carvel YTT Language Support

VSCode extension that provides language support for Carvel YTT (YAML Templating Tool) files.

## Features

- Syntax highlighting for YTT directives
- Code folding support for:
  - YTT blocks (`#@ if/end`, `#@ for/end`, `#@ def/end`)
  - YAML resources (starting with `apiVersion:`)
  - YAML blocks and lists
- Support for nested YTT directives
- Proper indentation handling

## Examples

### YTT Directive Folding

```yaml
#@ if data.values.enabled:
apiVersion: v1
kind: ConfigMap
metadata:
  name: test-config
data:
  key1: value1
#@ end
```


### Resource-Level Folding

```yaml
apiVersion: v1  # Click the fold icon here
kind: Service
metadata:
  name: test-service
spec:
  ports:
  - port: 80
    protocol: TCP
```

## Requirements

- VSCode 1.96.0 or higher

## Installation

1. Install through VS Code extensions
2. Search for "Carvel YTT Language Support"
3. Click Install

## Known Issues

Please report any issues on the GitHub repository.

## Release Notes

### 0.0.1

Initial release:
- Basic YTT syntax highlighting
- Code folding support
- YAML resource folding
