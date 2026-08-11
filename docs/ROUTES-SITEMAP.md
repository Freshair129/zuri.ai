# Routes / Sitemap

## Standalone MVP

```text
/
├── /overview
├── /workspaces
│   ├── /[workspaceId]
│   └── /[workspaceId]/projects
├── /projects
│   ├── /[projectId]
│   ├── /[projectId]/all-work
│   ├── /[projectId]/timeline
│   ├── /[projectId]/dependencies
│   ├── /[projectId]/milestones
│   ├── /[projectId]/repositories
│   ├── /[projectId]/import
│   └── /[projectId]/execution/[mode]
├── /execution
│   ├── /sprint
│   ├── /migration
│   ├── /b2b-sales
│   ├── /b2c-campaign
│   ├── /product-launch
│   ├── /operations
│   └── /expansion
├── /repositories
├── /audit
├── /backup
└── /settings
```

## Future Zuri module registry

Candidate module:

```js
projects: {
  label: 'Projects',
  icon: BriefcaseBusiness,
  subFeatures: [
    { label: 'Overview', path: '/projects', icon: LayoutDashboard },
    { label: 'Workspaces', path: '/projects/workspaces', icon: Layers3 },
    { label: 'All Work', path: '/projects/work', icon: ListChecks },
    { label: 'Timeline', path: '/projects/timeline', icon: GanttChartSquare },
    { label: 'Dependencies', path: '/projects/dependencies', icon: Network },
    { label: 'Repositories', path: '/projects/repositories', icon: GitBranch },
  ]
}
```

Execution-mode views should normally live inside project context rather than adding
seven permanent top-level Zuri modules.
