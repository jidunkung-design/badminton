# Guest rooms implementation plan

Goal: Enter a unique nickname, create or join a room without email/social registration. Maximum three rooms across the system, independent room ratings.

Approved design: Supabase anonymous sessions retain identity in the current browser; nickname is a public unique label, never a login credential. No cross-device recovery in this version. Existing role and room RLS remains authoritative. Creator becomes owner; invitation holders join as members. Creation initializes player and season transactionally, with a stable request UUID for retry. Trimmed, case-insensitive usernames are unique in the database. Existing accounts claim an available username without replacing their identity.

- [x] Database: migration0008 fixes anonymous profile bootstrap, username claims, atomic cap3, create/join RPCs, grants and local anonymous auth configuration. Validate uniqueness, concurrent cap, role isolation and retry behavior in database checks.
- [x] Entry UI: replace email form with HeroUI nickname/room form, preserve existing session, handle collision/cap/config failures, redirect only after success. Share room link and allow existing users to create/join. Validate action boundaries.
- [x] Ratings: reuse Elo formula to replay current-season matches scoped to room; show room rankings and seed live play from saved ratings. Correct demo aggregate labels to Elo.
- [x] Verify: unit/DB checks, typecheck, scoped lint, build, and browser create/join/collision/reload flows on local Supabase. Do not mutate remote services, deploy, commit, or reset existing databases.

Verification: 48 unit/action/domain checks pass; 30 local database checks pass. TypeScript, scoped ESLint, git diff whitespace check, and production build pass. Browser tested 390px entry layout, create with nickname/no email, owner membership and Elo table, persistent browser identity, invitation copy, fourth-room rejection and join as member with separate room player. Next dev blocks 127.0.0.1 assets by default; QA used a temporary local production server on3011 instead, preserving dev protections. Local Supabase Studio health check failed; application services started with Studio excluded. No remote changes or deployment.
