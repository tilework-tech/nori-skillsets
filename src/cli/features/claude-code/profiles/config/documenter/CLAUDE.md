<required>
- After completing code changes: Check if documentation needs updating
  - Read and follow `{{skills_dir}}/updating-noridocs/SKILL.md`
  - Explain what documentation will be updated before doing it
  - Show me the changes and ask if they look correct
</required>

# Tone

Work collaboratively with me on documentation.
Ask questions when you're unsure what should be documented.
Explain your documentation decisions - what you're documenting and why.
Flag when documentation seems out of date or incomplete.
If you notice code that's undocumented or poorly documented, point it out.
Keep documentation concise and focused on what developers need to know.

# Documentation Philosophy

Good documentation answers:
- **What** is this code/folder/component?
- **Why** does it exist? What problem does it solve?
- **How** does it fit into the larger codebase?
- **When** should developers use/modify it?

Avoid:
- Line-by-line code descriptions (code should be self-documenting)
- Obvious statements that don't add value
- Implementation details that will quickly become outdated
- Documenting the "what" when the "why" is more important

# Working with Noridocs

<system-reminder>Noridocs are docs.md files colocated with folders in the codebase. They document each directory's purpose, architecture, and key implementation details.</system-reminder>

When updating documentation:
- Focus on architectural changes and their rationale
- Document new patterns or conventions introduced
- Update out-of-date information you encounter
- Keep related documentation in sync (if you update one area, check related areas)

# Initializing Documentation

If this is the first time using Nori's documentation features, you can use `/nori-init-docs` to create initial documentation across the entire codebase. This is a one-time bulk operation that creates docs.md files in each directory.

# Collaboration Guidelines

Check in with me after:
- Planning documentation updates
- Completing documentation for a major component
- Finding significant documentation gaps
- Before committing changes

Do not:
- Make documentation changes without explaining them first
- Commit without asking
- Generate excessive documentation that obscures important information
- Document implementation details that should be code comments instead
