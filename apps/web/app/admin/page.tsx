"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Nav from "@/components/Nav";
import PageAccessGate from "@/components/PageAccessGate";
import {
  apiRequest,
  getMe,
  getSelectedCompanyId,
  setSelectedCompanyId,
} from "@/lib/api";
import { getAuthCompany, getAuthUser } from "@/lib/auth";

type AdminUser = {
  id: string;
  username: string;
  email?: string | null;
  role: string;
  active: boolean;
  status?: string;
  emailVerified?: boolean;
  mustChangePassword?: boolean;
  createdAt?: string;
};

type CompanyItem = {
  id: string;
  name: string;
  code: string;
  createdAt?: string;
  usersCount?: number;
};

const roleOptions = [
  { value: "VIEW_ONLY", label: "View Only", description: "Can view company data but cannot create or edit records." },
  { value: "CULTIVATION", label: "Cultivation", description: "Can work in cultivation areas." },
  { value: "EXTRACTION", label: "Extraction", description: "Can work in extraction areas." },
  { value: "PACKAGING", label: "Packaging", description: "Can work in packaging areas." },
  { value: "MANAGER", label: "Manager", description: "Can view users and manage production workflows." },
  { value: "ADMIN", label: "Admin", description: "Can create users and grant permissions." },
  { value: "OWNER", label: "Owner", description: "Application owner access." },
];

function getRoleColor(role: string) {
  if (role === "OWNER") return "#f59e0b";
  if (role === "ADMIN") return "#a855f7";
  if (role === "MANAGER") return "#38bdf8";
  if (role === "CULTIVATION") return "#22c55e";
  if (role === "EXTRACTION") return "#14b8a6";
  if (role === "PACKAGING") return "#ec4899";
  return "#94a3b8";
}

function canCreateUsers(role: string) {
  return role === "OWNER" || role === "ADMIN";
}

function canManageUsers(role: string) {
  return role === "OWNER" || role === "ADMIN";
}

function canEditTargetUser(currentRole: string, targetRole: string) {
  if (currentRole === "OWNER") return true;
  if (currentRole === "ADMIN" && targetRole !== "OWNER") return true;
  return false;
}

function getAllowedRoleOptions(currentRole: string) {
  if (currentRole === "OWNER") return roleOptions;
  return roleOptions.filter((option) => option.value !== "OWNER");
}

function getDisplayStatus(user: AdminUser) {
  if (user.status === "INVITED" || user.mustChangePassword) return "Invited";
  return user.active ? "Active" : "Inactive";
}

export default function AdminPage() {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [company, setCompany] = useState<any>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [companies, setCompanies] = useState<CompanyItem[]>([]);
  const [selectedCompanyId, setSelectedCompanyIdState] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("VIEW_ONLY");

  const [companyName, setCompanyName] = useState("");
  const [companyCode, setCompanyCode] = useState("");
  const [companyOwnerUsername, setCompanyOwnerUsername] = useState("");
  const [companyOwnerEmail, setCompanyOwnerEmail] = useState("");
  const [companyOwnerRole, setCompanyOwnerRole] = useState("ADMIN");

  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);
  const [editCompanyName, setEditCompanyName] = useState("");
  const [editCompanyCode, setEditCompanyCode] = useState("");
  const [savingCompanyId, setSavingCompanyId] = useState<string | null>(null);

  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editUsername, setEditUsername] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRole, setEditRole] = useState("VIEW_ONLY");
  const [editActive, setEditActive] = useState(true);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [notificationModal, setNotificationModal] = useState<{
    open: boolean;
    title: string;
    message: string;
    details?: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm?: (() => void) | null;
  }>({
    open: false,
    title: "",
    message: "",
    details: "",
    confirmText: "",
    cancelText: "",
    onConfirm: null,
  });

  async function loadAdminData() {
    setError("");
    setLoading(true);

    try {
      const me = await getMe();
      setCurrentUser(me.user);
      setCompany(me.company);

      if (me.user?.role === "OWNER") {
        const loadedCompanies = await apiRequest<CompanyItem[]>("/api/auth/companies");
        setCompanies(loadedCompanies);

        let savedCompanyId = getSelectedCompanyId();

        if (!savedCompanyId && loadedCompanies.length > 0) {
          savedCompanyId = loadedCompanies[0].id;
          setSelectedCompanyId(savedCompanyId);
        }

        const selectedCompany =
          loadedCompanies.find((c) => c.id === savedCompanyId) ||
          loadedCompanies[0] ||
          me.company;

        if (selectedCompany?.id) {
          setSelectedCompanyIdState(selectedCompany.id);
          setSelectedCompanyId(selectedCompany.id);
          setCompany(selectedCompany);

          const loadedUsers = await apiRequest<AdminUser[]>("/api/users", {
            companyId: selectedCompany.id,
          });
          setUsers(loadedUsers);
        } else {
          setUsers([]);
        }
      } else {
        const loadedUsers = await apiRequest<AdminUser[]>("/api/users");
        setUsers(loadedUsers);
      }
    } catch (err: any) {
      setError(err?.message || "Could not load admin data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setCurrentUser(getAuthUser());
    setCompany(getAuthCompany());
    loadAdminData();
  }, []);

  async function handleCompanySwitch(companyId: string) {
    setError("");
    setSuccess("");

    try {
      setSelectedCompanyId(companyId);
      setSelectedCompanyIdState(companyId);

      const selected = companies.find((c) => c.id === companyId);

      if (selected) {
        setCompany(selected);
      }

      const loadedUsers = await apiRequest<AdminUser[]>("/api/users", {
        companyId,
      });

      setUsers(loadedUsers);
      setSuccess("Switched company view.");
    } catch (err: any) {
      setError(err?.message || "Could not switch company.");
    }
  }

  function showConfirm(title: string, message: string, onConfirm: () => void, details = "") {
    setNotificationModal({
      open: true,
      title,
      message,
      details,
      confirmText: "Confirm",
      cancelText: "Cancel",
      onConfirm,
    });
  }

  function closeNotificationModal() {
    setNotificationModal({
      open: false,
      title: "",
      message: "",
      details: "",
      confirmText: "",
      cancelText: "",
      onConfirm: null,
    });
  }

  function confirmNotificationModal() {
    const action = notificationModal.onConfirm;
    closeNotificationModal();
    if (action) action();
  }

  async function createCompany(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (currentUser?.role !== "OWNER") {
      setError("Only OWNER can create companies.");
      return;
    }

    if (!companyName.trim() || !companyCode.trim()) {
      setError("Company name and company code are required.");
      return;
    }

    if (!companyOwnerUsername.trim() || !companyOwnerEmail.trim()) {
      setError("Starter username and starter email are required.");
      return;
    }

    if (companyOwnerRole !== "ADMIN" && companyOwnerRole !== "OWNER") {
      setError("Starter access must be Company Admin or Application Owner.");
      return;
    }

    try {
      const starterEmail = companyOwnerEmail.trim().toLowerCase();

      const newCompany = await apiRequest<any>("/api/auth/companies", {
        method: "POST",
        body: {
          name: companyName.trim(),
          code: companyCode.trim().toUpperCase(),
          ownerUsername: companyOwnerUsername.trim(),
          ownerEmail: starterEmail,
          ownerRole: companyOwnerRole,
        },
      });

      setCompanies((prev) => [newCompany, ...prev]);
      setCompanyName("");
      setCompanyCode("");
      setCompanyOwnerUsername("");
      setCompanyOwnerEmail("");
      setCompanyOwnerRole("ADMIN");

      setSuccess(`Created company ${newCompany.name}. Invite sent to ${starterEmail}.`);
    } catch (err: any) {
      setError(err?.message || "Could not create company.");
    }
  }

  function startEditCompany(companyItem: CompanyItem) {
    setError("");
    setSuccess("");
    setEditingCompanyId(companyItem.id);
    setEditCompanyName(companyItem.name || "");
    setEditCompanyCode(companyItem.code || "");
  }

  function cancelEditCompany() {
    setEditingCompanyId(null);
    setEditCompanyName("");
    setEditCompanyCode("");
  }

  async function saveEditedCompany(companyItem: CompanyItem) {
    setError("");
    setSuccess("");

    if (currentUser?.role !== "OWNER") {
      setError("Only OWNER can edit companies.");
      return;
    }

    if (!editCompanyName.trim() || !editCompanyCode.trim()) {
      setError("Company name and company code are required.");
      return;
    }

    setSavingCompanyId(companyItem.id);

    try {
      const updatedCompany = await apiRequest<CompanyItem>(
        `/api/auth/companies/${companyItem.id}`,
        {
          method: "PATCH",
          body: {
            name: editCompanyName.trim(),
            code: editCompanyCode.trim().toUpperCase(),
          },
        }
      );

      setCompanies((prev) =>
        prev.map((c) => (c.id === updatedCompany.id ? updatedCompany : c))
      );

      setEditingCompanyId(null);
      setSuccess(`Updated company ${updatedCompany.name}.`);
    } catch (err: any) {
      setError(err?.message || "Could not update company.");
    } finally {
      setSavingCompanyId(null);
    }
  }

  function deleteCompany(companyItem: CompanyItem) {
    showConfirm(
      "Delete Company",
      `Delete ${companyItem.name}?`,
      async () => {
        try {
          await apiRequest(`/api/auth/companies/${companyItem.id}`, {
            method: "DELETE",
          });

          setCompanies((prev) => prev.filter((c) => c.id !== companyItem.id));
          setSuccess(`Deleted company ${companyItem.name}.`);
        } catch (err: any) {
          setError(err?.message || "Could not delete company.");
        }
      },
      "This will remove the company and all users inside it. You cannot delete your own active company."
    );
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (!canCreateUsers(currentUser?.role || "")) {
      setError("Only OWNER or ADMIN users can invite new users.");
      return;
    }

    if (!username.trim()) {
      setError("Username is required.");
      return;
    }

    if (!email.trim()) {
      setError("Email is required for invites.");
      return;
    }

    if (!role.trim()) {
      setError("Role is required.");
      return;
    }

    if (currentUser?.role === "ADMIN" && role === "OWNER") {
      setError("Admins cannot invite application owners.");
      return;
    }

    setSaving(true);

    try {
      const response = await apiRequest<any>("/api/users/invite", {
        method: "POST",
        body: {
          username: username.trim(),
          email: email.trim(),
          role,
          companyId: currentUser?.role === "OWNER" ? selectedCompanyId : undefined,
        },
        companyId: currentUser?.role === "OWNER" ? selectedCompanyId : undefined,
      });

      const newUser = response?.user || response;

      setUsers((current) => [newUser, ...current]);
      setUsername("");
      setEmail("");
      setRole("VIEW_ONLY");

      if (response?.inviteUrl) {
        setSuccess(`Invite created for ${newUser.username}. Invite link: ${response.inviteUrl}`);
      } else {
        setSuccess(`Invite created for ${newUser.username}.`);
      }
    } catch (err: any) {
      setError(err?.message || "Could not invite user.");
    } finally {
      setSaving(false);
    }
  }

  function startEditUser(user: AdminUser) {
    setError("");
    setSuccess("");
    setEditingUserId(user.id);
    setEditUsername(user.username || "");
    setEditEmail(user.email || "");
    setEditRole(user.role || "VIEW_ONLY");
    setEditActive(user.active);
  }

  function cancelEditUser() {
    setEditingUserId(null);
    setEditUsername("");
    setEditEmail("");
    setEditRole("VIEW_ONLY");
    setEditActive(true);
  }

  async function saveEditedUser(user: AdminUser) {
    setError("");
    setSuccess("");

    if (!canManageUsers(currentUser?.role || "")) {
      setError("Only OWNER or ADMIN users can edit users.");
      return;
    }

    if (!canEditTargetUser(currentUser?.role || "", user.role)) {
      setError("You do not have permission to edit this user.");
      return;
    }

    if (currentUser?.role === "ADMIN" && editRole === "OWNER") {
      setError("Admins cannot make users application owners.");
      return;
    }

    if (!editUsername.trim()) {
      setError("Username is required.");
      return;
    }

    if (!editRole.trim()) {
      setError("Role is required.");
      return;
    }

    if (currentUser?.id === user.id && editActive === false) {
      setError("You cannot deactivate your own account while signed in.");
      return;
    }

    setSavingUserId(user.id);

    try {
      const updatedUser = await apiRequest<AdminUser>(`/api/users/${user.id}`, {
        method: "PATCH",
        body: {
          username: editUsername.trim(),
          email: editEmail.trim() || null,
          role: editRole,
          active: editActive,
        },
      });

      setUsers((current) =>
        current.map((u) => (u.id === updatedUser.id ? updatedUser : u))
      );

      setEditingUserId(null);
      setSuccess(`Updated user ${updatedUser.username}.`);
    } catch (err: any) {
      setError(err?.message || "Could not update user.");
    } finally {
      setSavingUserId(null);
    }
  }

  async function runToggleUserActive(user: AdminUser, nextActive: boolean) {
    setSavingUserId(user.id);

    try {
      const updatedUser = await apiRequest<AdminUser>(`/api/users/${user.id}`, {
        method: "PATCH",
        body: { active: nextActive },
      });

      setUsers((current) =>
        current.map((u) => (u.id === updatedUser.id ? updatedUser : u))
      );

      setSuccess(
        nextActive
          ? `Reactivated user ${updatedUser.username}.`
          : `Deactivated user ${updatedUser.username}.`
      );
    } catch (err: any) {
      setError(err?.message || "Could not update user status.");
    } finally {
      setSavingUserId(null);
    }
  }

  function toggleUserActive(user: AdminUser) {
    setError("");
    setSuccess("");

    if (!canManageUsers(currentUser?.role || "")) {
      setError("Only OWNER or ADMIN users can activate or deactivate users.");
      return;
    }

    if (!canEditTargetUser(currentUser?.role || "", user.role)) {
      setError("You do not have permission to change this user.");
      return;
    }

    if (currentUser?.id === user.id && user.active) {
      setError("You cannot deactivate your own account while signed in.");
      return;
    }

    const nextActive = !user.active;

    showConfirm(
      nextActive ? "Reactivate User" : "Deactivate User",
      nextActive ? `Reactivate ${user.username}?` : `Deactivate ${user.username}?`,
      () => runToggleUserActive(user, nextActive),
      nextActive
        ? "This user will be able to sign in again."
        : "This user will no longer be able to sign in or use the app."
    );
  }

  async function runDeleteUser(user: AdminUser) {
    setSavingUserId(user.id);

    try {
      await apiRequest(`/api/users/${user.id}`, {
        method: "DELETE",
      });

      setUsers((current) => current.filter((u) => u.id !== user.id));
      setSuccess(`Deleted user ${user.username}.`);
    } catch (err: any) {
      setError(err?.message || "Could not delete user.");
    } finally {
      setSavingUserId(null);
    }
  }

  function deleteUser(user: AdminUser) {
    setError("");
    setSuccess("");

    if (!canManageUsers(currentUser?.role || "")) {
      setError("Only OWNER or ADMIN users can delete users.");
      return;
    }

    if (!canEditTargetUser(currentUser?.role || "", user.role)) {
      setError("You do not have permission to delete this user.");
      return;
    }

    if (currentUser?.id === user.id) {
      setError("You cannot delete your own account while signed in.");
      return;
    }

    showConfirm(
      "Delete User",
      `Delete ${user.username}?`,
      () => runDeleteUser(user),
      "This removes the user from this company. This cannot be undone."
    );
  }

  const allowedRoleOptions = getAllowedRoleOptions(currentUser?.role || "");

  return (
    <PageAccessGate allowedRoles={["ADMIN", "OWNER"]}>
      <main
        style={{
          minHeight: "100vh",
          background:
            "radial-gradient(circle at top left, rgba(168,85,247,0.18), transparent 34%), radial-gradient(circle at top right, rgba(34,197,94,0.14), transparent 34%), #020617",
          color: "white",
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 1180, margin: "0 auto" }}>
          <header
            style={{
              background: "rgba(15, 23, 42, 0.84)",
              border: "1px solid rgba(148, 163, 184, 0.22)",
              borderRadius: 24,
              padding: 28,
              boxShadow: "0 24px 70px rgba(0,0,0,0.35)",
              marginBottom: 22,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 18,
                alignItems: "flex-start",
                flexWrap: "wrap",
              }}
            >
              <div>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    background: "rgba(168, 85, 247, 0.12)",
                    color: "#d8b4fe",
                    border: "1px solid rgba(168, 85, 247, 0.28)",
                    padding: "7px 12px",
                    borderRadius: 999,
                    fontSize: 13,
                    fontWeight: 800,
                    marginBottom: 14,
                  }}
                >
                  Company Admin
                </div>

                <h1
                  style={{
                    fontSize: "clamp(34px, 5vw, 56px)",
                    lineHeight: 1,
                    margin: 0,
                    letterSpacing: "-0.05em",
                    fontWeight: 950,
                  }}
                >
                  User Access & Permissions
                </h1>

                <p
                  style={{
                    maxWidth: 760,
                    color: "#cbd5e1",
                    fontSize: 18,
                    lineHeight: 1.6,
                    marginTop: 16,
                    marginBottom: 0,
                  }}
                >
                  Invite people to your company workspace, assign permissions,
                  edit users, deactivate access, or delete accounts.
                </p>
              </div>

              <div
                style={{
                  minWidth: 240,
                  background: "rgba(2, 6, 23, 0.74)",
                  border: "1px solid rgba(148, 163, 184, 0.18)",
                  borderRadius: 18,
                  padding: 16,
                }}
              >
                <div style={smallLabelStyle}>Company</div>

                <div style={{ fontSize: 24, fontWeight: 900 }}>
                  {company?.name || "—"}
                </div>

                {currentUser?.role === "OWNER" && companies.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <div style={smallLabelStyle}>View Company</div>

                    <select
                      value={selectedCompanyId}
                      onChange={(e) => handleCompanySwitch(e.target.value)}
                      style={inputStyle}
                    >
                      {companies.map((companyItem) => (
                        <option key={companyItem.id} value={companyItem.id}>
                          {companyItem.name} ({companyItem.code})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div style={{ color: "#64748b", marginTop: 4 }}>
                  Signed in as {currentUser?.username || "—"}
                </div>

                <div
                  style={{
                    display: "inline-flex",
                    marginTop: 10,
                    padding: "6px 10px",
                    borderRadius: 999,
                    background: `${getRoleColor(currentUser?.role || "")}22`,
                    border: `1px solid ${getRoleColor(currentUser?.role || "")}66`,
                    color: getRoleColor(currentUser?.role || ""),
                    fontWeight: 900,
                    fontSize: 13,
                  }}
                >
                  {currentUser?.role || "—"}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 24 }}>
              <Nav />
            </div>
          </header>

          {loading ? (
            <section style={panelStyle}>
              <h2 style={sectionTitleStyle}>Loading Admin Data...</h2>
            </section>
          ) : (
            <>
              {error && (
                <div
                  style={{
                    ...messageStyle,
                    background: "rgba(127, 29, 29, 0.58)",
                    border: "1px solid rgba(248, 113, 113, 0.5)",
                    color: "#fecaca",
                  }}
                >
                  {error}
                </div>
              )}

              {success && (
                <div
                  style={{
                    ...messageStyle,
                    background: "rgba(20, 83, 45, 0.58)",
                    border: "1px solid rgba(34, 197, 94, 0.5)",
                    color: "#bbf7d0",
                    wordBreak: "break-word",
                  }}
                >
                  {success}
                </div>
              )}

              <section
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(280px, 420px) 1fr",
                  gap: 18,
                  alignItems: "start",
                }}
              >
                <div style={{ display: "grid", gap: 18 }}>
                  <form onSubmit={createUser} style={panelStyle} autoComplete="off">
                    <h2 style={sectionTitleStyle}>Invite User</h2>

                    {!canCreateUsers(currentUser?.role || "") && (
                      <div
                        style={{
                          background: "rgba(120, 53, 15, 0.55)",
                          border: "1px solid rgba(251, 191, 36, 0.35)",
                          color: "#fde68a",
                          borderRadius: 14,
                          padding: 12,
                          marginBottom: 16,
                          lineHeight: 1.45,
                        }}
                      >
                        Your role can view this page, but only OWNER or ADMIN users
                        can invite new users.
                      </div>
                    )}

                    <label style={labelStyle}>
                      Username
                      <input
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        style={inputStyle}
                        placeholder="example: john"
                        autoComplete="off"
                        name="invite-user-username"
                      />
                    </label>

                    <label style={labelStyle}>
                      Email Required
                      <input
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        style={inputStyle}
                        type="email"
                        placeholder="example@email.com"
                        autoComplete="off"
                        name="invite-user-email"
                      />
                    </label>

                    <label style={labelStyle}>
                      Role / Access Level
                      <select
                        value={role}
                        onChange={(e) => setRole(e.target.value)}
                        style={inputStyle}
                      >
                        {allowedRoleOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div
                      style={{
                        background: "rgba(2, 6, 23, 0.72)",
                        border: "1px solid rgba(148, 163, 184, 0.16)",
                        borderRadius: 12,
                        padding: 10,
                        color: "#94a3b8",
                        lineHeight: 1.4,
                        marginBottom: 14,
                        fontSize: 14,
                      }}
                    >
                      {
                        roleOptions.find((option) => option.value === role)
                          ?.description
                      }
                    </div>

                    <button
                      type="submit"
                      disabled={saving || !canCreateUsers(currentUser?.role || "")}
                      style={{
                        width: "100%",
                        border: "none",
                        borderRadius: 12,
                        padding: "11px 14px",
                        background:
                          saving || !canCreateUsers(currentUser?.role || "")
                            ? "#475569"
                            : "#a855f7",
                        color: "white",
                        fontWeight: 900,
                        fontSize: 15,
                        cursor:
                          saving || !canCreateUsers(currentUser?.role || "")
                            ? "not-allowed"
                            : "pointer",
                      }}
                    >
                      {saving ? "Sending Invite..." : "Send Invite"}
                    </button>
                  </form>

                  {currentUser?.role === "OWNER" && (
                    <section style={panelStyle}>
                      <h2 style={sectionTitleStyle}>Companies</h2>

                      <form
                        onSubmit={createCompany}
                        style={{
                          display: "grid",
                          gap: 12,
                          marginBottom: 18,
                        }}
                      >
                        <label style={labelStyle}>
                          Company Name
                          <input
                            value={companyName}
                            onChange={(e) => setCompanyName(e.target.value)}
                            style={inputStyle}
                            placeholder="Company Name"
                          />
                        </label>

                        <label style={labelStyle}>
                          Company Code
                          <input
                            value={companyCode}
                            onChange={(e) => setCompanyCode(e.target.value.toUpperCase())}
                            style={inputStyle}
                            placeholder="Company Code"
                          />
                        </label>

                        <label style={labelStyle}>
                          New Company Starter Username
                          <input
                            value={companyOwnerUsername}
                            onChange={(e) => setCompanyOwnerUsername(e.target.value)}
                            style={inputStyle}
                            placeholder="owner username"
                            autoComplete="off"
                          />
                        </label>

                        <label style={labelStyle}>
                          New Company Starter Email Required
                          <input
                            value={companyOwnerEmail}
                            onChange={(e) => setCompanyOwnerEmail(e.target.value)}
                            style={inputStyle}
                            type="email"
                            placeholder="owner@email.com"
                            autoComplete="off"
                          />
                        </label>

                        <label style={labelStyle}>
                          New Company Starter Access
                          <select
                            value={companyOwnerRole}
                            onChange={(e) => setCompanyOwnerRole(e.target.value)}
                            style={inputStyle}
                          >
                            <option value="ADMIN">Company Admin</option>
                            <option value="OWNER">Application Owner</option>
                          </select>
                        </label>

                        <div
                          style={{
                            background: "rgba(2, 6, 23, 0.72)",
                            border: "1px solid rgba(148, 163, 184, 0.16)",
                            borderRadius: 12,
                            padding: 10,
                            color: "#94a3b8",
                            lineHeight: 1.4,
                            fontSize: 13,
                          }}
                        >
                          This creates the company and sends an email invite to the starter user. The account becomes active after they set their password.
                        </div>

                        <button
                          type="submit"
                          style={{
                            width: "100%",
                            border: "none",
                            borderRadius: 12,
                            padding: "11px 14px",
                            background: "#f59e0b",
                            color: "white",
                            fontWeight: 900,
                            fontSize: 15,
                            cursor: "pointer",
                          }}
                        >
                          Add Company + Send Starter Invite
                        </button>
                      </form>

                      <div style={{ display: "grid", gap: 10 }}>
                        {companies.length === 0 ? (
                          <div style={{ color: "#94a3b8" }}>No companies found.</div>
                        ) : (
                          companies.map((companyItem) => {
                            const isEditingCompany = editingCompanyId === companyItem.id;

                            return (
                              <div
                                key={companyItem.id}
                                style={{
                                  background: "rgba(2, 6, 23, 0.72)",
                                  border: "1px solid rgba(148,163,184,0.16)",
                                  borderRadius: 14,
                                  padding: 14,
                                  display: "grid",
                                  gap: 12,
                                }}
                              >
                                {!isEditingCompany ? (
                                  <>
                                    <div>
                                      <div style={{ fontWeight: 900 }}>
                                        {companyItem.name}
                                      </div>

                                      <div style={{ color: "#94a3b8", fontSize: 13 }}>
                                        Code: {companyItem.code}
                                      </div>

                                      <div style={{ color: "#64748b", fontSize: 12 }}>
                                        Users: {companyItem.usersCount || 0}
                                      </div>
                                    </div>

                                    <div
                                      style={{
                                        display: "flex",
                                        justifyContent: "flex-end",
                                        gap: 8,
                                        flexWrap: "wrap",
                                      }}
                                    >
                                      <button
                                        type="button"
                                        onClick={() => startEditCompany(companyItem)}
                                        style={{
                                          ...smallButtonStyle,
                                          background: "rgba(56, 189, 248, 0.16)",
                                          border: "1px solid rgba(56, 189, 248, 0.4)",
                                          color: "#bae6fd",
                                          cursor: "pointer",
                                        }}
                                      >
                                        Edit
                                      </button>

                                      <button
                                        type="button"
                                        onClick={() => deleteCompany(companyItem)}
                                        style={{
                                          ...smallButtonStyle,
                                          background: "rgba(127, 29, 29, 0.38)",
                                          border: "1px solid rgba(248,113,113,0.46)",
                                          color: "#fecaca",
                                          cursor: "pointer",
                                        }}
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <label style={labelStyle}>
                                      Company Name
                                      <input
                                        value={editCompanyName}
                                        onChange={(e) => setEditCompanyName(e.target.value)}
                                        style={inputStyle}
                                      />
                                    </label>

                                    <label style={labelStyle}>
                                      Company Code
                                      <input
                                        value={editCompanyCode}
                                        onChange={(e) => setEditCompanyCode(e.target.value.toUpperCase())}
                                        style={inputStyle}
                                      />
                                    </label>

                                    <div
                                      style={{
                                        display: "flex",
                                        justifyContent: "flex-end",
                                        gap: 8,
                                        flexWrap: "wrap",
                                      }}
                                    >
                                      <button
                                        type="button"
                                        onClick={cancelEditCompany}
                                        disabled={savingCompanyId === companyItem.id}
                                        style={{
                                          ...smallButtonStyle,
                                          background: "rgba(71, 85, 105, 0.32)",
                                          border: "1px solid rgba(148, 163, 184, 0.28)",
                                          color: "#cbd5e1",
                                        }}
                                      >
                                        Cancel
                                      </button>

                                      <button
                                        type="button"
                                        onClick={() => saveEditedCompany(companyItem)}
                                        disabled={savingCompanyId === companyItem.id}
                                        style={{
                                          ...smallButtonStyle,
                                          background: "#22c55e",
                                          border: "1px solid rgba(34, 197, 94, 0.7)",
                                          color: "white",
                                        }}
                                      >
                                        {savingCompanyId === companyItem.id ? "Saving..." : "Save"}
                                      </button>
                                    </div>
                                  </>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </section>
                  )}
                </div>

                <section style={panelStyle}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      alignItems: "center",
                      marginBottom: 16,
                      flexWrap: "wrap",
                    }}
                  >
                    <h2 style={sectionTitleStyle}>Company Users</h2>

                    <div
                      style={{
                        display: "flex",
                        gap: 10,
                        flexWrap: "wrap",
                        alignItems: "center",
                      }}
                    >
                      <Link
                        href="/admin/config"
                        style={{
                          textDecoration: "none",
                          border: "1px solid rgba(37, 99, 235, 0.4)",
                          background: "rgba(37, 99, 235, 0.16)",
                          color: "#bfdbfe",
                          borderRadius: 12,
                          padding: "10px 14px",
                          fontWeight: 800,
                          display: "inline-block",
                        }}
                      >
                        Company Config
                      </Link>

                      <button
                        type="button"
                        onClick={loadAdminData}
                        style={{
                          border: "1px solid rgba(148, 163, 184, 0.28)",
                          background: "rgba(2, 6, 23, 0.72)",
                          color: "#cbd5e1",
                          borderRadius: 12,
                          padding: "10px 13px",
                          fontWeight: 800,
                          cursor: "pointer",
                        }}
                      >
                        Refresh
                      </button>
                    </div>
                  </div>

                  <div style={{ display: "grid", gap: 12 }}>
                    {users.length === 0 ? (
                      <div style={{ color: "#94a3b8" }}>No users found.</div>
                    ) : (
                      users.map((user) => {
                        const isEditing = editingUserId === user.id;
                        const canManageThisUser =
                          canManageUsers(currentUser?.role || "") &&
                          canEditTargetUser(currentUser?.role || "", user.role);

                        return (
                          <div
                            key={user.id}
                            style={{
                              background: "rgba(2, 6, 23, 0.72)",
                              border: user.active
                                ? "1px solid rgba(148, 163, 184, 0.16)"
                                : "1px solid rgba(248, 113, 113, 0.28)",
                              borderRadius: 16,
                              padding: 16,
                              display: "grid",
                              gap: 14,
                            }}
                          >
                            {!isEditing ? (
                              <>
                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    gap: 14,
                                    alignItems: "center",
                                    flexWrap: "wrap",
                                  }}
                                >
                                  <div>
                                    <div
                                      style={{
                                        fontSize: 18,
                                        fontWeight: 900,
                                        marginBottom: 4,
                                      }}
                                    >
                                      {user.username}
                                    </div>

                                    <div style={{ color: "#94a3b8" }}>
                                      {user.email || "No email saved"}
                                    </div>

                                    <div
                                      style={{
                                        color: user.active ? "#64748b" : "#fca5a5",
                                        fontSize: 13,
                                        marginTop: 6,
                                        fontWeight: 800,
                                      }}
                                    >
                                      Status: {getDisplayStatus(user)}
                                    </div>
                                  </div>

                                  <div
                                    style={{
                                      display: "inline-flex",
                                      padding: "7px 11px",
                                      borderRadius: 999,
                                      background: `${getRoleColor(user.role)}22`,
                                      border: `1px solid ${getRoleColor(user.role)}66`,
                                      color: getRoleColor(user.role),
                                      fontWeight: 900,
                                      fontSize: 13,
                                    }}
                                  >
                                    {user.role}
                                  </div>
                                </div>

                                <div
                                  style={{
                                    display: "flex",
                                    gap: 8,
                                    flexWrap: "wrap",
                                    justifyContent: "flex-end",
                                  }}
                                >
                                  <button
                                    type="button"
                                    disabled={!canManageThisUser || savingUserId === user.id}
                                    onClick={() => startEditUser(user)}
                                    style={{
                                      ...smallButtonStyle,
                                      background: canManageThisUser
                                        ? "rgba(56, 189, 248, 0.16)"
                                        : "rgba(71, 85, 105, 0.45)",
                                      border: canManageThisUser
                                        ? "1px solid rgba(56, 189, 248, 0.4)"
                                        : "1px solid rgba(71, 85, 105, 0.5)",
                                      color: canManageThisUser ? "#bae6fd" : "#94a3b8",
                                      cursor: canManageThisUser ? "pointer" : "not-allowed",
                                    }}
                                  >
                                    Edit
                                  </button>

                                  <button
                                    type="button"
                                    disabled={!canManageThisUser || savingUserId === user.id}
                                    onClick={() => toggleUserActive(user)}
                                    style={{
                                      ...smallButtonStyle,
                                      background: user.active
                                        ? "rgba(245, 158, 11, 0.14)"
                                        : "rgba(34, 197, 94, 0.14)",
                                      border: user.active
                                        ? "1px solid rgba(245, 158, 11, 0.42)"
                                        : "1px solid rgba(34, 197, 94, 0.42)",
                                      color: user.active ? "#fde68a" : "#bbf7d0",
                                      cursor: canManageThisUser ? "pointer" : "not-allowed",
                                    }}
                                  >
                                    {user.active ? "Deactivate" : "Reactivate"}
                                  </button>

                                  <button
                                    type="button"
                                    disabled={!canManageThisUser || savingUserId === user.id}
                                    onClick={() => deleteUser(user)}
                                    style={{
                                      ...smallButtonStyle,
                                      background: "rgba(127, 29, 29, 0.38)",
                                      border: "1px solid rgba(248, 113, 113, 0.46)",
                                      color: "#fecaca",
                                      cursor: canManageThisUser ? "pointer" : "not-allowed",
                                    }}
                                  >
                                    Delete
                                  </button>
                                </div>
                              </>
                            ) : (
                              <>
                                <div
                                  style={{
                                    display: "grid",
                                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                                    gap: 12,
                                  }}
                                >
                                  <label style={labelStyle}>
                                    Username
                                    <input
                                      value={editUsername}
                                      onChange={(e) => setEditUsername(e.target.value)}
                                      style={inputStyle}
                                    />
                                  </label>

                                  <label style={labelStyle}>
                                    Email Optional
                                    <input
                                      value={editEmail}
                                      onChange={(e) => setEditEmail(e.target.value)}
                                      style={inputStyle}
                                    />
                                  </label>

                                  <label style={labelStyle}>
                                    Role
                                    <select
                                      value={editRole}
                                      onChange={(e) => setEditRole(e.target.value)}
                                      style={inputStyle}
                                    >
                                      {allowedRoleOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>

                                  <label style={labelStyle}>
                                    Status
                                    <select
                                      value={editActive ? "ACTIVE" : "INACTIVE"}
                                      onChange={(e) => setEditActive(e.target.value === "ACTIVE")}
                                      style={inputStyle}
                                    >
                                      <option value="ACTIVE">Active</option>
                                      <option value="INACTIVE">Inactive</option>
                                    </select>
                                  </label>
                                </div>

                                <div
                                  style={{
                                    background: "rgba(2, 6, 23, 0.72)",
                                    border: "1px solid rgba(148, 163, 184, 0.16)",
                                    borderRadius: 14,
                                    padding: 12,
                                    color: "#94a3b8",
                                    lineHeight: 1.45,
                                  }}
                                >
                                  {roleOptions.find((option) => option.value === editRole)?.description}
                                </div>

                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "flex-end",
                                    gap: 8,
                                    flexWrap: "wrap",
                                  }}
                                >
                                  <button
                                    type="button"
                                    onClick={cancelEditUser}
                                    disabled={savingUserId === user.id}
                                    style={{
                                      ...smallButtonStyle,
                                      background: "rgba(71, 85, 105, 0.32)",
                                      border: "1px solid rgba(148, 163, 184, 0.28)",
                                      color: "#cbd5e1",
                                    }}
                                  >
                                    Cancel
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => saveEditedUser(user)}
                                    disabled={savingUserId === user.id}
                                    style={{
                                      ...smallButtonStyle,
                                      background: "#22c55e",
                                      border: "1px solid rgba(34, 197, 94, 0.7)",
                                      color: "white",
                                    }}
                                  >
                                    {savingUserId === user.id ? "Saving..." : "Save Changes"}
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </section>
              </section>
            </>
          )}
        </div>

        {notificationModal.open && (
          <div style={modalOverlayStyle}>
            <div style={{ ...modalStyle, maxWidth: 560 }}>
              <h2 style={{ marginTop: 0, marginBottom: 10 }}>
                {notificationModal.title}
              </h2>

              <p style={{ color: "#cbd5e1", marginTop: 0, lineHeight: 1.6 }}>
                {notificationModal.message}
              </p>

              {notificationModal.details ? (
                <div
                  style={{
                    background: "#020617",
                    border: "1px solid #334155",
                    borderRadius: 12,
                    padding: 12,
                    marginTop: 12,
                    marginBottom: 18,
                    color: "#cbd5e1",
                  }}
                >
                  {notificationModal.details}
                </div>
              ) : null}

              <div
                style={{
                  display: "flex",
                  gap: 10,
                  justifyContent: "center",
                  flexWrap: "wrap",
                  marginTop: 18,
                }}
              >
                {notificationModal.cancelText ? (
                  <button style={modalButtonStyle} onClick={closeNotificationModal}>
                    {notificationModal.cancelText}
                  </button>
                ) : null}

                <button
                  style={dangerModalButtonStyle}
                  onClick={confirmNotificationModal}
                >
                  {notificationModal.confirmText || "Confirm"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </PageAccessGate>
  );
}

const panelStyle: React.CSSProperties = {
  background: "rgba(15, 23, 42, 0.78)",
  border: "1px solid rgba(148, 163, 184, 0.2)",
  borderRadius: 22,
  padding: 18,
  boxShadow: "0 18px 50px rgba(0,0,0,0.28)",
};

const sectionTitleStyle: React.CSSProperties = {
  margin: 0,
  marginBottom: 14,
  fontSize: 22,
  fontWeight: 950,
  letterSpacing: "-0.03em",
};

const smallLabelStyle: React.CSSProperties = {
  color: "#94a3b8",
  fontSize: 13,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  marginBottom: 8,
};

const labelStyle: React.CSSProperties = {
  display: "block",
  color: "#cbd5e1",
  fontWeight: 800,
  fontSize: 14,
  marginBottom: 10,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid rgba(148, 163, 184, 0.3)",
  background: "#020617",
  color: "white",
  borderRadius: 10,
  padding: "9px 12px",
  outline: "none",
  fontSize: 14,
  marginTop: 4,
  minHeight: 42,
  boxSizing: "border-box",
};

const messageStyle: React.CSSProperties = {
  borderRadius: 16,
  padding: 14,
  marginBottom: 18,
  fontWeight: 800,
};

const smallButtonStyle: React.CSSProperties = {
  borderRadius: 10,
  padding: "9px 12px",
  fontWeight: 900,
  fontSize: 13,
};

const modalOverlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(2, 6, 23, 0.78)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
  padding: 20,
};

const modalStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 760,
  background: "#0f172a",
  border: "1px solid #334155",
  borderRadius: 18,
  padding: 24,
  boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
  maxHeight: "85vh",
  overflowY: "auto",
};

const modalButtonStyle: React.CSSProperties = {
  background: "#334155",
  color: "white",
  border: "1px solid #475569",
  borderRadius: 10,
  padding: "10px 12px",
  cursor: "pointer",
  fontWeight: 800,
};

const dangerModalButtonStyle: React.CSSProperties = {
  ...modalButtonStyle,
  background: "#7f1d1d",
  border: "1px solid #ef4444",
  color: "#fecaca",
};