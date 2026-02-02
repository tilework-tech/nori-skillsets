---
description: Validate Nori Skillsets installation and configuration
allowed-tools: Bash(nori-skillsets:*)
---

Run the following diagnostic commands to validate the Nori Skillsets installation:

1. Check installation location:

```bash
nori-skillsets install-location
```

2. Verify the config file exists and is valid:

```bash
cat ~/.claude/.nori-config.json | head -20
```

3. Check hooks configuration:

```bash
cat ~/.claude/settings.json | grep -A 5 nori
```

4. Verify installed version:

```bash
nori-skillsets --version
```

## Troubleshooting

If you encounter installation issues, check the installer log file:

```bash
cat /tmp/nori-installer.log
```

This log contains detailed information about the installation process and any errors encountered.
