'use client'

import { useState } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MoreHorizontal, Trash2, AlertTriangle, Edit } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { RoleBadges } from '@/components/auth/role-selector'
import {
  assignWards,
  deleteUser,
  type UserWithRoles,
} from '@/lib/auth/admin-actions'

interface UserTableProps {
  users: UserWithRoles[]
  allRoles: Array<{ id: string; name: string }>
  allWards: Array<{ id: string; name: string }>
  currentUserId: string
  onUsersChange: () => void
  onEditUser: (user: UserWithRoles) => void
  onRolesUser: (user: UserWithRoles) => void
}

export function UserTable({
  users,
  allRoles,
  allWards,
  currentUserId,
  onUsersChange,
  onEditUser,
  onRolesUser,
}: UserTableProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [userToDelete, setUserToDelete] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  // Ward membership (spec v0.12.0). Minimal by design: a checkbox per ward on
  // the row; each toggle replaces the user's full membership set server-side.
  const [savingWardsFor, setSavingWardsFor] = useState<string | null>(null)
  const [wardError, setWardError] = useState<string | null>(null)

  const toggleWard = async (
    user: UserWithRoles,
    wardId: string,
    isMember: boolean,
  ) => {
    const next = isMember
      ? [...user.wardIds, wardId]
      : user.wardIds.filter((id) => id !== wardId)
    setSavingWardsFor(user.id)
    setWardError(null)
    try {
      await assignWards({ userId: user.id, wardIds: next })
      onUsersChange()
    } catch (error) {
      setWardError(
        error instanceof Error
          ? error.message
          : 'Failed to update ward membership',
      )
    } finally {
      setSavingWardsFor(null)
    }
  }

  const handleDelete = (userId: string) => {
    setUserToDelete(userId)
    setDeleteDialogOpen(true)
    setDeleteError(null)
  }

  const confirmDelete = async () => {
    if (!userToDelete) return
    setIsDeleting(true)
    setDeleteError(null)
    try {
      await deleteUser(userToDelete)
      setDeleteDialogOpen(false)
      setUserToDelete(null)
      onUsersChange()
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : 'Failed to delete user',
      )
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="space-y-4">
      {wardError && <p className="text-destructive text-sm">{wardError}</p>}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead>Wards</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell>{user.name ?? '—'}</TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>
                  <RoleBadges
                    roleIds={user.roles.map((r) => r.id)}
                    allRoles={allRoles}
                  />
                </TableCell>
                <TableCell>
                  {allWards.length === 0 ? (
                    <span className="text-muted-foreground text-sm">
                      No wards
                    </span>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {allWards.map((ward) => (
                        <label
                          key={ward.id}
                          className="flex items-center gap-2 text-sm whitespace-nowrap"
                        >
                          <input
                            type="checkbox"
                            checked={user.wardIds.includes(ward.id)}
                            disabled={savingWardsFor === user.id}
                            onChange={(e) =>
                              toggleWard(user, ward.id, e.target.checked)
                            }
                          />
                          {ward.name}
                        </label>
                      ))}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">Open menu</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => onEditUser(user)}
                        className="flex items-center gap-2"
                      >
                        <Edit className="h-4 w-4" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => onRolesUser(user)}
                        className="flex items-center gap-2"
                      >
                        <Badge variant="outline" className="ml-auto">
                          Roles
                        </Badge>
                        Manage Roles
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {user.id !== currentUserId ? (
                        <DropdownMenuItem
                          onClick={() => handleDelete(user.id)}
                          className="text-destructive focus:text-destructive flex items-center gap-2"
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem className="text-muted-foreground flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4" />
                          Cannot delete self
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Delete Confirmation Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-dialog-title"
        className={
          deleteDialogOpen
            ? 'fixed inset-0 z-50 flex items-center justify-center'
            : 'hidden'
        }
      >
        <div
          className="fixed inset-0 bg-black/50"
          onClick={() => setDeleteDialogOpen(false)}
        />
        <div className="bg-background relative mx-4 w-full max-w-md rounded-lg p-6 shadow-lg">
          <h3 id="delete-dialog-title" className="mb-2 text-lg font-semibold">
            Delete User
          </h3>
          <p className="text-muted-foreground mb-4">
            Are you sure you want to delete this user? This action cannot be
            undone.
          </p>
          {deleteError && (
            <p className="text-destructive mb-4 text-sm">{deleteError}</p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              confirmDelete()
            }}
          >
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeleteDialogOpen(false)}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={isDeleting}>
                {isDeleting ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
