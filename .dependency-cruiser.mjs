// Architecture rules from the "代码结构" section of .docs/architecture.md
// (`task architecture`). Paths are relative to the repository root.

const api = '^apps/api/src/';
const modules = `${api}modules/`;
const features = '^apps/web/src/app/features/';

/** @type {import('dependency-cruiser').IConfiguration} */
export default {
  forbidden: [
    {
      name: 'no-circular',
      comment: 'No module may depend on itself, directly or through others.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-unresolvable',
      comment: 'Every import resolves, so no dependency escapes these rules unseen.',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'api-controller-only-to-service',
      comment: 'A controller reaches the data through a service, never a repository directly.',
      severity: 'error',
      from: { path: `${modules}.+\\.controller\\.ts$` },
      to: { path: `${modules}.+\\.repository\\.ts$` },
    },
    {
      name: 'api-service-not-to-controller',
      comment: 'Calls go down from controller to service to repository, never up.',
      severity: 'error',
      from: { path: `${modules}.+\\.service\\.ts$` },
      to: { path: `${modules}.+\\.controller\\.ts$` },
    },
    {
      name: 'api-repository-not-up',
      comment: 'A repository only reads and writes data; it calls no service or controller.',
      severity: 'error',
      from: { path: `${modules}.+\\.repository\\.ts$` },
      to: { path: `${modules}.+\\.(controller|service)\\.ts$` },
    },
    {
      name: 'api-modules-only-through-services',
      comment:
        'A module uses another module only through its exported service, and imports that module to reach it; never its repository or anything else.',
      severity: 'error',
      from: { path: `${modules}([^/]+)/` },
      to: {
        path: modules,
        pathNot: [`${modules}$1/`, `${modules}[^/]+/[^/]+\\.(service|module)\\.ts$`],
      },
    },
    {
      name: 'api-infrastructure-not-to-modules',
      comment: 'Every layer may use the infrastructure; the infrastructure knows no module.',
      severity: 'error',
      from: { path: `${api}infrastructure/` },
      to: { path: modules },
    },
    {
      name: 'web-features-independent',
      comment: 'A web feature does not import another feature.',
      severity: 'error',
      from: { path: `${features}([^/]+)/` },
      to: { path: features, pathNot: `${features}$1/` },
    },
    {
      name: 'web-shared-and-core-not-to-features',
      comment: 'shared and core serve every feature, so they import none.',
      severity: 'error',
      from: { path: '^apps/web/src/app/(shared|core)/' },
      to: { path: features },
    },
    {
      name: 'web-not-to-api',
      comment: 'The web app shares code with the api only through packages/contracts.',
      severity: 'error',
      from: { path: '^apps/web/' },
      to: { path: '^apps/api/' },
    },
    {
      name: 'api-not-to-web',
      comment: 'The api shares code with the web app only through packages/contracts.',
      severity: 'error',
      from: { path: '^apps/api/' },
      to: { path: '^apps/web/' },
    },
    {
      name: 'contracts-not-to-apps',
      comment: 'The contracts package holds only the interface contracts and imports no app.',
      severity: 'error',
      from: { path: '^packages/contracts/' },
      to: { path: '^apps/' },
    },
  ],
  options: {
    // Build output is kept as a dependency target, so an import of another
    // package's built files still counts as an import of that package, but
    // is not cruised itself. Imports of @thinklet/contracts resolve to its
    // build, so it must be built first.
    doNotFollow: { path: ['(^|/)node_modules/', '(^|/)dist/'] },
    exclude: { path: ['(^|/)coverage/', '(^|/)\\.angular/', '(^|/)out-tsc/'] },
    // Workspace packages resolve through the pnpm symlinks to their real
    // path, so a cross-package import is seen under packages/ or apps/.
    preserveSymlinks: false,
    combinedDependencies: true,
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types'],
    },
  },
};
