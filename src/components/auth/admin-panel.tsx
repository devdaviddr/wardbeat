'use client'

import { useState } from 'react'
import { Plus, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { UserTable } from '@/components/auth/user-table'
import { UserForm } from '@/components/auth/user-form'
import {
  getAllUsersWithRoles,
  type UserWithRoles,
} from '@/lib/auth/admin-actions'

interface AdminPanelProps {
  initialUsers: UserWithRoles[]
  allRoles: Array<{ id: string; name: string }>
  allWards: Array<{ id: string; name: string }>
  currentUserId: string
}

export function AdminPanel({
  initialUsers,
  allRoles,
  allWards,
  currentUserId,
}: AdminPanelProps) {
  const [users, setUsers] = useState<UserWithRoles[]>(initialUsers)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editUser, setEditUser] = useState<UserWithRoles | null>(null)
  const [rolesUser, setRolesUser] = useState<UserWithRoles | null>(null)

  const handleRefresh = async () => {
    try {
      const result = await getAllUsersWithRoles()
      if (result) setUsers(result)
    } catch {
      // Session may have lapsed mid-page; ignore and let the next render redirect.
    }
  }

  const handleCreateSuccess = () => {
    setCreateDialogOpen(false)
    handleRefresh()
  }

  const handleEditSuccess = () => {
    setEditUser(null)
    handleRefresh()
  }

  const handleRolesSuccess = () => {
    setRolesUser(null)
    handleRefresh()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <Users className="h-5 w-5" />
            Admin Panel
          </h2>
          <p className="text-muted-foreground text-sm">
            Manage users and their roles
          </p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)} size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Add User
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Users</CardTitle>
          <CardDescription>
            {users.length} user{users.length !== 1 ? 's' : ''} in the system
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UserTable
            users={users}
            allRoles={allRoles}
            allWards={allWards}
            currentUserId={currentUserId}
            onUsersChange={handleRefresh}
            onEditUser={setEditUser}
            onRolesUser={setRolesUser}
          />
        </CardContent>
      </Card>

      <UserForm
        mode="create"
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        allRoles={allRoles}
        onSuccess={handleCreateSuccess}
      />

      <UserForm
        mode="edit"
        open={!!editUser}
        onOpenChange={(open) => !open && setEditUser(null)}
        allRoles={allRoles}
        initialData={
          editUser
            ? {
                id: editUser.id,
                name: editUser.name ?? undefined,
                email: editUser.email,
                roleIds: editUser.roles.map((r) => r.id),
              }
            : undefined
        }
        onSuccess={handleEditSuccess}
      />

      <UserForm
        mode="roles"
        open={!!rolesUser}
        onOpenChange={(open) => !open && setRolesUser(null)}
        allRoles={allRoles}
        initialData={
          rolesUser
            ? { id: rolesUser.id, roleIds: rolesUser.roles.map((r) => r.id) }
            : undefined
        }
        onSuccess={handleRolesSuccess}
      />
    </div>
  )
}
