# emailToDiscord-bot

Simple Google Apps Script that forwards Huly emails to Discord via webhooks.

## Configuration

This script uses Script Properties (the Apps Script equivalent of environment
variables) to hold Discord webhook URLs. Defaults are included in the code for
convenience, but you should override them in Script Properties to avoid
committing secrets to source control.

For local reference there's a `.env` file in the repo with matching variable
names. The `.env` file maps to the Script Property keys, for example `WEBHOOK_GENERAL`.
# discord-bot