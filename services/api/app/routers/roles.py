import json

import grpc
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from app.models.guild import RoleCreateRequest, RoleUpdateRequest, RoleResponse
from app.middleware.auth import get_current_user_id
from app.db.connection import get_redis
from app.grpc_client import get_role_stub, get_member_stub, get_user_stub
from app.grpc_errors import handle_grpc_error
from app.grpc_stubs import relay_pb2 as pb2
from app.routers.audit_log import create_audit_log, AuditLogAction
from app.services.permissions import (
    require_permission,
    require_role_hierarchy,
    has_permission,
    MANAGE_ROLES,
    ADMINISTRATOR,
)
from app.routers.guilds import require_member

router = APIRouter(prefix="/api/v10/guilds", tags=["roles"])


def _role_response_from_proto(role) -> RoleResponse:
    return RoleResponse(
        id=str(role.id),
        name=role.name,
        color=role.color or 0,
        hoist=role.hoist or False,
        position=role.position or 0,
        permissions=str(role.permissions),
        managed=role.managed or False,
        mentionable=role.mentionable or False,
    )


# ---------- GET /guilds/{guild_id}/roles ----------

@router.get("/{guild_id}/roles")
async def list_roles(
    guild_id: str,
    user_id: str = Depends(get_current_user_id),
):
    gid = int(guild_id)
    uid = int(user_id)

    await require_member(gid, uid)

    role_stub = await get_role_stub()
    try:
        resp = await role_stub.GetRoles(pb2.GetRolesRequest(guild_id=gid))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="role")

    return [_role_response_from_proto(r).model_dump() for r in resp.roles]


# ---------- POST /guilds/{guild_id}/roles ----------

@router.post("/{guild_id}/roles", status_code=201)
async def create_role(
    guild_id: str,
    body: RoleCreateRequest,
    user_id: str = Depends(get_current_user_id),
):
    gid = int(guild_id)
    uid = int(user_id)

    actor_perms = await require_permission(gid, uid, MANAGE_ROLES)

    permissions_int = int(body.permissions) if body.permissions else 0

    # Elevation guard: a non-administrator may not grant permission bits they don't hold
    # themselves (stops a MANAGE_ROLES-only moderator minting an ADMINISTRATOR role).
    if not has_permission(actor_perms, ADMINISTRATOR) and (permissions_int & ~actor_perms) != 0:
        raise HTTPException(
            status_code=403,
            detail={"code": 50013, "message": "Cannot grant permissions you do not have"},
        )

    role_stub = await get_role_stub()
    try:
        role = await role_stub.CreateRole(
            pb2.CreateRoleRequest(
                guild_id=gid,
                name=body.name,
                color=body.color or 0,
                hoist=body.hoist or False,
                position=0,  # Data services will assign next position
                permissions=permissions_int,
                mentionable=body.mentionable or False,
            )
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="role")

    role_resp = _role_response_from_proto(role)

    # Audit log
    await create_audit_log(
        gid, uid, role.id, AuditLogAction.ROLE_CREATE,
        changes={"name": body.name, "permissions": str(permissions_int), "color": body.color},
    )

    # Publish GUILD_ROLE_CREATE event
    redis = await get_redis()
    event = {"t": "GUILD_ROLE_CREATE", "d": {"guild_id": guild_id, "role": role_resp.model_dump()}}
    await redis.publish(f"guild:{gid}", json.dumps(event))

    return role_resp.model_dump()


# ---------- PATCH /guilds/{guild_id}/roles/{role_id} ----------

@router.patch("/{guild_id}/roles/{role_id}")
async def update_role(
    guild_id: str,
    role_id: str,
    body: RoleUpdateRequest,
    user_id: str = Depends(get_current_user_id),
):
    gid = int(guild_id)
    rid = int(role_id)
    uid = int(user_id)

    actor_perms = await require_permission(gid, uid, MANAGE_ROLES)

    # Fetch existing role
    role_stub = await get_role_stub()
    try:
        existing = await role_stub.GetRole(
            pb2.GetRoleRequest(guild_id=gid, role_id=rid)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="role")

    # Cannot rename the @everyone role
    if rid == gid and body.name is not None:
        raise HTTPException(
            status_code=400,
            detail={"code": 50028, "message": "Cannot rename @everyone role"},
        )

    if rid == gid and body.position is not None:
        raise HTTPException(
            status_code=400,
            detail={"code": 50028, "message": "Cannot edit @everyone role's position"},
        )

    # Role hierarchy check
    await require_role_hierarchy(gid, uid, existing.position)

    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(
            status_code=400,
            detail={"code": 50035, "message": "Invalid Form Body"},
        )

    update_kwargs: dict = {"guild_id": gid, "role_id": rid}
    if "name" in updates:
        update_kwargs["name"] = updates["name"]
    if "color" in updates:
        update_kwargs["color"] = updates["color"]
    if "hoist" in updates:
        update_kwargs["hoist"] = updates["hoist"]
    if "permissions" in updates and updates["permissions"] is not None:
        new_permissions = int(updates["permissions"])
        # Stop a non-admin MANAGE_ROLES holder from granting permission bits they don't
        # themselves hold (privilege escalation) -- mirrors the guard in create_role.
        if not has_permission(actor_perms, ADMINISTRATOR) and (new_permissions & ~actor_perms) != 0:
            raise HTTPException(
                status_code=403,
                detail={"code": 50013, "message": "Cannot grant permissions you do not have"},
            )
        update_kwargs["permissions"] = new_permissions
    if "mentionable" in updates:
        update_kwargs["mentionable"] = updates["mentionable"]

    try:
        updated = await role_stub.UpdateRole(pb2.UpdateRoleRequest(**update_kwargs))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="role")

    role_resp = _role_response_from_proto(updated)

    # Audit log
    await create_audit_log(
        gid, uid, rid, AuditLogAction.ROLE_UPDATE, changes=updates,
    )

    # Publish GUILD_ROLE_UPDATE event
    redis = await get_redis()
    event = {"t": "GUILD_ROLE_UPDATE", "d": {"guild_id": guild_id, "role": role_resp.model_dump()}}
    await redis.publish(f"guild:{gid}", json.dumps(event))

    return role_resp.model_dump()


# ---------- DELETE /guilds/{guild_id}/roles/{role_id} ----------

@router.delete("/{guild_id}/roles/{role_id}", status_code=204)
async def delete_role(
    guild_id: str,
    role_id: str,
    user_id: str = Depends(get_current_user_id),
):
    gid = int(guild_id)
    rid = int(role_id)
    uid = int(user_id)

    await require_permission(gid, uid, MANAGE_ROLES)

    if rid == gid:
        raise HTTPException(
            status_code=400,
            detail={"code": 50028, "message": "Cannot delete @everyone role"},
        )

    role_stub = await get_role_stub()
    try:
        existing = await role_stub.GetRole(
            pb2.GetRoleRequest(guild_id=gid, role_id=rid)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="role")

    await require_role_hierarchy(gid, uid, existing.position)

    try:
        await role_stub.DeleteRole(pb2.DeleteRoleRequest(guild_id=gid, role_id=rid))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="role")

    # Audit log
    await create_audit_log(
        gid, uid, rid, AuditLogAction.ROLE_DELETE,
        changes={"name": existing.name},
    )

    # Publish GUILD_ROLE_DELETE event
    redis = await get_redis()
    event = {"t": "GUILD_ROLE_DELETE", "d": {"guild_id": guild_id, "role_id": role_id}}
    await redis.publish(f"guild:{gid}", json.dumps(event))

    return Response(status_code=204)


# ---------- PUT /guilds/{guild_id}/members/{user_id}/roles/{role_id} ----------

@router.put("/{guild_id}/members/{member_id}/roles/{role_id}", status_code=204)
async def add_member_role(
    guild_id: str,
    member_id: str,
    role_id: str,
    user_id: str = Depends(get_current_user_id),
):
    gid = int(guild_id)
    mid = int(member_id)
    rid = int(role_id)
    uid = int(user_id)

    actor_perms = await require_permission(gid, uid, MANAGE_ROLES)

    # Get role for hierarchy check
    role_stub = await get_role_stub()
    try:
        role = await role_stub.GetRole(pb2.GetRoleRequest(guild_id=gid, role_id=rid))
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="role")

    await require_role_hierarchy(gid, uid, role.position)

    # Don't let a non-admin assign a role carrying permission bits the actor doesn't hold,
    # or MANAGE_ROLES becomes a path to granting yourself (or anyone) arbitrary permissions.
    role_perms = int(role.permissions)
    if not has_permission(actor_perms, ADMINISTRATOR) and (role_perms & ~actor_perms) != 0:
        raise HTTPException(
            status_code=403,
            detail={"code": 50013, "message": "Cannot assign a role with permissions you do not have"},
        )

    member_stub = await get_member_stub()
    try:
        await member_stub.AddMemberRole(
            pb2.AddMemberRoleRequest(guild_id=gid, user_id=mid, role_id=rid)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="member")

    # Audit log
    await create_audit_log(
        gid, uid, mid, AuditLogAction.MEMBER_ROLE_UPDATE,
        changes={"$add": str(rid)},
    )

    # Publish GUILD_MEMBER_UPDATE event with full user object
    redis = await get_redis()
    try:
        roles_resp = await member_stub.GetMemberRoles(
            pb2.GetMemberRolesRequest(guild_id=gid, user_id=mid)
        )
        roles = [str(r) for r in roles_resp.role_ids]
    except grpc.RpcError:
        roles = []

    user_stub = await get_user_stub()
    try:
        user_row = await user_stub.GetUser(pb2.GetUserRequest(user_id=mid))
        user_obj = {
            "id": str(mid),
            "username": user_row.username,
            "discriminator": "0",
            "global_name": user_row.display_name if user_row.display_name else None,
            "avatar": user_row.avatar if user_row.avatar else None,
            "bot": False,
            "flags": 0,
            "public_flags": 0,
        }
    except grpc.RpcError:
        user_obj = {"id": str(mid), "username": "", "discriminator": "0"}

    event = {
        "t": "GUILD_MEMBER_UPDATE",
        "d": {
            "guild_id": guild_id,
            "user": user_obj,
            "roles": roles,
            "nick": None,
            "avatar": None,
            "joined_at": "",
            "premium_since": None,
            "deaf": False,
            "mute": False,
            "flags": 0,
            "pending": False,
            "communication_disabled_until": None,
        },
    }
    await redis.publish(f"guild:{gid}", json.dumps(event))

    return Response(status_code=204)


# ---------- DELETE /guilds/{guild_id}/members/{user_id}/roles/{role_id} ----------

@router.delete("/{guild_id}/members/{member_id}/roles/{role_id}", status_code=204)
async def remove_member_role(
    guild_id: str,
    member_id: str,
    role_id: str,
    user_id: str = Depends(get_current_user_id),
):
    gid = int(guild_id)
    mid = int(member_id)
    rid = int(role_id)
    uid = int(user_id)

    await require_permission(gid, uid, MANAGE_ROLES)

    if rid == gid:
        raise HTTPException(
            status_code=400,
            detail={"code": 50028, "message": "Cannot remove @everyone role"},
        )

    # Check role hierarchy
    role_stub = await get_role_stub()
    try:
        role = await role_stub.GetRole(pb2.GetRoleRequest(guild_id=gid, role_id=rid))
        await require_role_hierarchy(gid, uid, role.position)
    except grpc.RpcError:
        pass

    member_stub = await get_member_stub()
    try:
        await member_stub.RemoveMemberRole(
            pb2.RemoveMemberRoleRequest(guild_id=gid, user_id=mid, role_id=rid)
        )
    except grpc.RpcError as exc:
        handle_grpc_error(exc, resource="member")

    # Audit log
    await create_audit_log(
        gid, uid, mid, AuditLogAction.MEMBER_ROLE_UPDATE,
        changes={"$remove": str(rid)},
    )

    # Publish GUILD_MEMBER_UPDATE event with full user object
    redis = await get_redis()
    try:
        roles_resp = await member_stub.GetMemberRoles(
            pb2.GetMemberRolesRequest(guild_id=gid, user_id=mid)
        )
        roles = [str(r) for r in roles_resp.role_ids]
    except grpc.RpcError:
        roles = []

    user_stub = await get_user_stub()
    try:
        user_row = await user_stub.GetUser(pb2.GetUserRequest(user_id=mid))
        user_obj = {
            "id": str(mid),
            "username": user_row.username,
            "discriminator": "0",
            "global_name": user_row.display_name if user_row.display_name else None,
            "avatar": user_row.avatar if user_row.avatar else None,
            "bot": False,
            "flags": 0,
            "public_flags": 0,
        }
    except grpc.RpcError:
        user_obj = {"id": str(mid), "username": "", "discriminator": "0"}

    event = {
        "t": "GUILD_MEMBER_UPDATE",
        "d": {
            "guild_id": guild_id,
            "user": user_obj,
            "roles": roles,
            "nick": None,
            "avatar": None,
            "joined_at": "",
            "premium_since": None,
            "deaf": False,
            "mute": False,
            "flags": 0,
            "pending": False,
            "communication_disabled_until": None,
        },
    }
    await redis.publish(f"guild:{gid}", json.dumps(event))

    return Response(status_code=204)
