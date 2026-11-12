# Monzo for Pebble

A Pebble watchapp that connects to the [Monzo Pebble Plugin](https://github.com/BenBJD/monzo-pebble-plugin) via the new Pebble Plugins API (`finance/*` sources) to display account balances, daily spending, and savings pots directly on your wrist.

## Features

- **At-a-Glance Balances**: View current account balance, today's spend, and total balance with pots.
- **Pebble Plugin Integration**: Subscribes directly to `finance/*` data sources (`finance/account`, `finance/pot`, `finance/configured`) provided by the Monzo Pebble Plugin.
- **Theme Options**: Supports Light and Dark modes across color and monochrome screens.
- **Cross-Platform**: Compatible with `aplite`, `basalt`, `chalk`, `diorite`, `emery`, `flint`, and `gabbro`.

## Setup & Configuration

This watchapp relies on the **Monzo Pebble Plugin** installed on your Pebble phone app to supply bank data.

1. Install and configure the **Monzo Pebble Plugin** (enter your Monzo Developer credentials and authenticate).
2. Install the **Monzo** watchapp onto your watch.
3. The watchapp will automatically subscribe to the plugin sources and display your accounts.

## Building from Source

### Prerequisites

- Python 3.10 to 3.13
- Node.js and npm
- [`uv`](https://astral.sh/uv) (recommended)

### Install Pebble Tool & SDK

```bash
# Install pebble-tool via uv
uv tool install pebble-tool --python 3.13

# Install the latest Pebble SDK
pebble sdk install latest
```

### Build & Install

```bash
# Build the .pbw package
pebble build

# Install onto watch locally or through CloudPebble
pebble install --phone <PHONE_IP>
# Or
pebble install --cloudpebble

# Or run in the emulator
pebble install --emulator basalt
```

## License

MIT
