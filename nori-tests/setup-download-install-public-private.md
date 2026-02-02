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

3. Make sure you cleaned up correctly by running install-location and verifying there are no existing profiles.

<system-reminder> It is ok if there are managed install locations. There should be no 'source' install locations </system-reminder>

```bash
node build/src/cli/nori-skillsets.js install-location
```

4. Download the amol skillset and the onboarding skillset from public.

```bash
node build/src/cli/nori-skillsets.js download amol
node build/src/cli/nori-skillsets.js download onboarding
```

5. Confirm that the download worked by looking at the ~/.nori/profiles directory.

6. Switch to the amol skillset.

```bash
node build/src/cli/nori-skillsets.js switch-skillset amol
```

7. Confirm that the switch worked by checking the CLAUDE.md file at <tmppath>/.claude/CLAUDE.md.

- Make sure that the templating worked as expected.

8. Switch to the onboarding skillset.

9. Confirm that the switch worked by checking the CLAUDE.md file.

10. Run login.

```bash
node build/src/cli/nori-skillsets.js login
```

- Ask the user for creds or look in .env for skillset email and password creds

11. Download the vc-tech-investing skillset from the dev private repo.

```bash
node build/src/cli/nori-skillsets.js download dev/vc-tech-investing
```

12. Switch to the vc-tech-investing skillset. Confirm that it loaded correctly.
