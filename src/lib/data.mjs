// Plain build-time JSON imports (bundled by Vite), safe to use from Astro frontmatter /
// getStaticPaths. No longer required by a filesystem-less adapter sandbox (the Cloudflare
// adapter was removed - see CLAUDE.md's Deploy note); kept as static imports for simplicity/
// Vite's build-time dead-code elimination rather than fs.readFileSync at build time.
import activities from '../data/activities.json';
import goalTargets from '../data/goal-targets.json';
import gear from '../data/gear.json';
import records from '../data/records.json';
import events from '../data/events.json';
import profile from '../data/profile.json';

export const loadActivities = () => activities;
export const loadGoalTargets = () => goalTargets;
export const loadGear = () => gear;
export const loadRecords = () => records;
export const loadEvents = () => events;
export const loadProfile = () => profile;
