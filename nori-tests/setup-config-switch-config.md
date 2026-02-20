# Setup, Download, Install Public / Private E2E Test

<required>
*CRITICAL* Add the following steps to your Todo list using TodoWrite:

1. Create and cd into a tmp directory. Make sure it is clean.

```bash
rm -r /tmp/skillset-test && mkdir /tmp/skillset-test
```

2. Build.

```bash
npm run build
```

3. Set the config to use the new temp directory (store the current install directory first by stating it out loud in the text stream).

```bash
node build/src/cli/nori-skillsets.js config
```

4. Download the amol skillset from public if it does not already exist.

```bash
ls ~/.nori/profiles/amol # OR
node build/src/cli/nori-skillsets.js download amol
```

5. Add some default config to the tmp dir.

```bash
mkdir <tmpdir>/.claude
touch <tmpdir>/.claude/CLAUDE.md
echo "HELLO" >> <tmpdir>/.claude/CLAUDE.md
```

6. Switch to the amol skillset. Confirm that a pop up appeared asking whether to create a new skillset from the existing config.

```bash
node build/src/cli/nori-skillsets.js switch amol
```

7. Overwrite the changes and check that the amol config successfully loaded into the tmp directory.

8. Reset the config to point to the original install directory.
