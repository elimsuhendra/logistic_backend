let indexTime = 0

const menuPermissions = [
  {
    seeder: true,
    locked: true,
    createdAt: Date.now() + indexTime++,
    updatedAt: null,
    deletedAt: null,
    inactive: false,
    label: "Dashboard",
    code: "dashboard",
    permissions: {
      view: {
        enable: true,
        url: "/dashboard",
      },
      create: {
        enable: false,
        url: "/dashboard/create",
      },
      update: {
        enable: false,
        url: "/dashboard/update",
      },
      delete: {
        enable: false,
        url: "/dashboard/delete",
      },
    },
  },
  {
    seeder: true,
    locked: true,
    createdAt: Date.now() + indexTime++,
    updatedAt: null,
    deletedAt: null,
    inactive: false,
    label: "Users",
    code: "users",
    permissions: {
      view: {
        enable: true,
        url: "/users",
      },
      create: {
        enable: true,
        url: "/users/create",
      },
      update: {
        enable: true,
        url: "/users/update",
      },
      delete: {
        enable: true,
        url: "/users/delete",
      },
    },
  },
  {
    seeder: true,
    locked: true,
    createdAt: Date.now() + indexTime++,
    updatedAt: null,
    deletedAt: null,
    inactive: false,
    label: "Menu Permissions",
    code: "menu_permissions",
    permissions: {
      view: {
        enable: true,
        url: "/menu-permissions",
      },
      create: {
        enable: true,
        url: "/menu-permissions/create",
      },
      update: {
        enable: true,
        url: "/menu-permissions/update",
      },
      delete: {
        enable: true,
        url: "/menu-permissions/delete",
      },
    },
  },
  {
    seeder: true,
    locked: true,
    createdAt: Date.now() + indexTime++,
    updatedAt: null,
    deletedAt: null,
    inactive: false,
    label: "Roles",
    code: "roles",
    permissions: {
      view: {
        enable: true,
        url: "/roles",
      },
      create: {
        enable: true,
        url: "/roles/create",
      },
      update: {
        enable: true,
        url: "/roles/update",
      },
      delete: {
        enable: true,
        url: "/roles/delete",
      },
    },
  },
  {
    seeder: true,
    locked: true,
    createdAt: Date.now() + indexTime++,
    updatedAt: null,
    deletedAt: null,
    inactive: false,
    label: "Accounts",
    code: "accounts",
    permissions: {
      view: {
        enable: true,
        url: "/accounts",
      },
      create: {
        enable: true,
        url: "/accounts/create",
      },
      update: {
        enable: true,
        url: "/accounts/update",
      },
      delete: {
        enable: true,
        url: "/accounts/delete",
      },
    },
  },
  {
    seeder: true,
    locked: true,
    createdAt: Date.now() + indexTime++,
    updatedAt: null,
    deletedAt: null,
    inactive: false,
    label: "Settings",
    code: "settings",
    permissions: {
      view: {
        enable: true,
        url: "/settings",
      },
      create: {
        enable: true,
        url: "/settings/create",
      },
      update: {
        enable: true,
        url: "/settings/update",
      },
      delete: {
        enable: true,
        url: "/settings/delete",
      },
    },
  },
]

export default menuPermissions

