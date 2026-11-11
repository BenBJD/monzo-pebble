# Monzo for Pebble

A Pebble watchapp and system plugin that connects to the Monzo Developer API to display account balances, daily spending, and savings pots directly on your wrist.

## Features

- **Multi-Account Support**: Switch between up to 4 Monzo accounts (Personal, Joint, Flex, and Business).
- **At-a-Glance Balances**: View current account balance, today's spend, and total balance with pots.
- **Pot Breakdown**: Open the details view to inspect individual savings pots and their balances.
- **Pebble Plugin Integration**: Exposes standard `finance/*` sources (`finance/account`, `finance/pot`, `finance/transaction`, `finance/configured`) and actions (`deposit_pot`, `withdraw_pot`) for system integration and third-party watchfaces.
- **Theme Options**: Supports Light and Dark modes across color and monochrome screens.
- **Cross-Platform**: Compatible with `aplite`, `basalt`, `chalk`, `diorite`, `emery`, `flint`, and `gabbro`.

## Setup & Configuration

To connect the app to your Monzo account, you need personal API credentials from the Monzo Developer Portal:

1. Visit the [Monzo Developer Portal](https://developers.monzo.com/) and sign in.
2. Under **Clients**, click **New Client**.
3. Set the following fields:
   - **Name**: `Monzo Pebble` (or your choice)
   - **Redirect URLs**: The URL of your hosted callback page (you can use `https://benbjd.github.io/monzo-pebble/callback.html` - I won't see anything)
   - **Description**: Personal Pebble watch integration
   - **Confidentiality**: Confidential
4. Save the client and copy your **Client ID** and **Client Secret**.
5. Open the watchapp settings page inside the Pebble mobile companion app:
   - Enter your **Client ID**, **Client Secret**, and **Redirect URI**.
   - Tap **Authorize on Monzo** to open the login page in your browser.
   - Approve the login request in your Monzo mobile app.
   - Copy the authorization code shown on the callback page, paste it into the settings page, and tap **Connect Account**.

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
