# NAME

bb-customize3 - Generate a new Extended Widget

## SYNOPSIS

```bash
bb-customize3 [--help] [-v|--version]
bb-customize3 <source-widget>
bb-customize3 <source-widget> --title target-widget --module target-module
bb-customize3 <source-widget> --title target-widget --module target-module --enable-slots
bb-customize3 --list
```

## USAGE
```
Usage: bb-customize3 [options] <file ...>

Options:
  -V, --version          output the version number
  -t, --title <name>     Widget Title (eg. Custom Product Summary)
  -m, --module <module>  Module Name (eg. product-summary-extended)
  -s, --enable-slots     Enable Extension Slots (commented by default)
  --list                 List all available widgets
  -h, --help             output usage information
```

## DESCRIPTION

Running this command wil generate a new Extended Widget that will copy from the specified Widget the following:
 - Preferences
 - Input/Outputs
 - Extension slot HTML

Important: A lot of Widgets leverage a 'Common' library, make sure to include that library as a Angular Module dependency manually, eg:
 TransactionsCommonModule
 ProductSummaryCommon

The tool will ask you first:
 1. Which Widget you would like to Extend (select from list)
 2. The name of the New Component (eg. Extended Product Summary Widget)
 3. The name of the New Widget (eg. product-summary-widget-extended)

## EXAMPLES

### List all available widgets

Lists all widget from default 'node_modules' directory:

```bash
  $ bb-customize3 --list
```

### Enable Extension slots

All extension slots templates will be uncommented. This flag could be usefull for testing if OOB Extension slots are working.

```bash
  $ bb-customize3 --enable-slots
```

## DISCLAIMER

This is a community supported tool, and is not affiliated or maintained by any commercial company.
Usage is at your own risk!