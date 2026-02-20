# Setup, Download, Install Public / Private E2E Test

<required>
*CRITICAL* Add the following steps to your Todo list using TodoWrite:

1. Create and cd into a tmp directory. Make sure it is clean.

```bash
rm -r /tmp/skillset-test && mkdir /tmp/skillset-test
```

2. Clean the nori profiles for the profiles to test.
```bash
rm -r [~/.nori/profiles/amol, ~/.nori/profiles/onboarding, ~/.nori/profiles/dev/vc-tech-investing]
```


3. Build.

```bash
npm run build
```

4. Set the config to use the new temp directory.
```bash
node build/src/cli/nori-skillsets.js config
```

5. Download the amol skillset and the onboarding skillset from public.

```bash
node build/src/cli/nori-skillsets.js download amol
node build/src/cli/nori-skillsets.js download onboarding
```

6. Confirm that the download worked by looking at the ~/.nori/profiles directory.

7. Switch to the amol skillset.

```bash
node build/src/cli/nori-skillsets.js switch-skillset amol
```

8. Confirm that the switch worked by checking the CLAUDE.md file at <tmppath>/.claude/CLAUDE.md.

- Make sure that the templating worked as expected.

9. Switch to the onboarding skillset.

10. Confirm that the switch worked by checking the CLAUDE.md file.

11. Run login.

```bash
node build/src/cli/nori-skillsets.js login
```

- Ask the user for creds or look in .env for skillset email and password creds

12. Download the vc-tech-investing skillset from the dev private repo.

```bash
node build/src/cli/nori-skillsets.js download dev/vc-tech-investing
```

13. Switch to the vc-tech-investing skillset. Confirm that it loaded correctly.
