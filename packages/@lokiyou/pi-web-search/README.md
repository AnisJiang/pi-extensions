# @lokiyou/pi-web-search

Simple web search for Pi Coding Agent.

Install it, add your API keys if needed, and ask normal questions. The extension is designed to work out of the box without requiring users to understand provider selection, search routing, or internal tool flow.

## What it does

It adds web search and page-reading capability to Pi.

After installation, you can ask Pi to:

- find recent information on the web
- open a page and summarize it
- gather sources when you need references
- do broader research on a topic

Most users do not need to call the tools manually.

## Installation

```bash
pi install npm:@lokiyou/pi-web-search
/reload
```

## Configuration

On first load, the extension creates a config file at:

```text
~/.pi/agent/extensions/pi-web-search/config.json
```

In most cases, you only need to add the API keys you want to use. You do not need to tune the internal settings unless you have a specific reason.

Example:

```json
{
  "provider": "auto",
  "grokApiUrl": "",
  "grokApiKey": "",
  "grokModel": "",
  "tavilyApiUrl": "",
  "tavilyApiKey": "",
  "context7ApiKey": "",
  "anysearchApiKey": ""
}
```

After updating the config, run `/reload` in Pi.

## How to use it

After installation, use normal prompts such as:

- "Find the latest AI news."
- "Search for recent updates on local-first databases."
- "Read this article and summarize it for me."
- "Research this topic from multiple angles."

If you want bilingual search, use the `query1 | query2` format when needed.

## License

MIT
