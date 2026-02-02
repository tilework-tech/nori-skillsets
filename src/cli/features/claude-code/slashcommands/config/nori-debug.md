---
description: Validate Nori Skillsets installation and configuration
allowed-tools: Bash(nori-skillsets:*)
---

Run the following diagnostic commands to validate the Nori Skillsets installation:

1. Verify the config file exists and is valid:

```bash
cat ~/.nori/.nori-config.json | head -20
```

2. Check hooks configuration:

```bash
cat ~/.claude/settings.json | grep -A 5 nori
```

3. Verify installed version:

```bash
nori-skillsets --version
```

## Troubleshooting

If you encounter installation issues, check the installer log file:

```bash
cat /tmp/nori-installer.log
```

This log contains detailed information about the installation process and any errors encountered.
