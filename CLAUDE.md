# CLAUDE.md

## Language

Use **TypeScript** everywhere. All source files must be `.ts` or `.tsx`. Do not create `.js` files.

All models, state types, and enums are defined in `src/models.ts` — import from there rather than re-declaring types locally.

## Documentation

Use TypeDoc (`/** */`) for all exported types, enums, and their members. Every field must have a doc comment. Do not use inline `//` comments on type fields — move them to `/** */` above the field.
