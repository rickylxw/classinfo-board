package io.github.rickylxw.classinfoboard.data

import kotlinx.serialization.Serializable

/* 与后端 API 对齐的数据模型（字段与 src/api.js 契约一致，宽松反序列化） */

@Serializable
data class Me(
    val xh: String = "",
    val admin: Boolean = false,
    val hasPassword: Boolean? = null
)

@Serializable
data class LoginResp(
    val token: String,
    val xh: String,
    val isNew: Boolean = false
)

@Serializable
data class Course(
    val id: String,
    val name: String,
    val teacher: String? = null,
    val semester: String? = null,
    val category: String? = null,
    val color: String? = null,
    val note: String? = null
)

@Serializable
data class Assignment(
    val id: String,
    val courseId: String,
    val title: String,
    val deadline: String? = null,
    val status: String? = null,
    val requirement: String? = null,
    val archived: Boolean = false
)

@Serializable
data class FileRec(
    val id: String,
    val courseId: String? = null,
    val name: String? = null,
    val kind: String? = null,
    val size: Long = 0,
    val url: String? = null,
    val note: String? = null
)

/* GET /api/data：服务器权威快照 */
@Serializable
data class CloudData(
    val courses: List<Course> = emptyList(),
    val assignments: List<Assignment> = emptyList(),
    val files: List<FileRec> = emptyList(),
    val syncStatus: Map<String, String> = emptyMap()
)

/* GET /api/sync：负责人共享板同步（key = 课程键，见 Board.courseKeyOf） */
@Serializable
data class SyncAssignment(
    val id: String,
    val title: String,
    val deadline: String? = null,
    val requirement: String? = null
)

@Serializable
data class SyncFile(
    val id: String,
    val name: String,
    val size: Long = 0
)

@Serializable
data class SyncGroup(
    val id: String? = null,
    val type: String? = null,
    val num: String? = null,
    val link: String? = null,
    val note: String? = null
)

@Serializable
data class SyncBoard(
    val from: String? = null,
    val assignments: List<SyncAssignment> = emptyList(),
    val files: List<SyncFile> = emptyList(),
    val groups: List<SyncGroup> = emptyList()
)

@Serializable
data class PasswordLoginReq(val xh: String, val password: String)

@Serializable
data class CookieLoginReq(val cookie: String)

@Serializable
data class SemStartResp(val semStart: String? = null)

/* POST /data/ops 响应：带应用后的权威快照，客户端直接采纳 */
@Serializable
data class PushOpsResp(
    val ok: Boolean = false,
    val data: CloudData? = null,
    val dataUpdatedAt: Long = 0
)

@Serializable
data class OkResp(val ok: Boolean = false)

@Serializable
data class FeedbackReq(
    val type: String,
    val content: String,
    val app: String,
    val device: String
)

/* ---------- 共享板（负责人管理 + 成员投稿） ---------- */

@Serializable
data class ShareStatus(
    val status: String = "none",
    val isOwner: Boolean = false,
    val hasOwner: Boolean = false
)

/** 共享板里的教学群与「班级同步」的群同构，别名以区分用途 */
typealias BoardGroup = SyncGroup

@Serializable
data class BoardAssignment(
    val id: String,
    val title: String,
    val deadline: String? = null,
    val requirement: String? = null
)

@Serializable
data class BoardFile(
    val id: String,
    val name: String,
    val size: Long = 0
)

@Serializable
data class BoardPendingAssignment(
    val id: String,
    val title: String,
    val deadline: String? = null,
    val requirement: String? = null,
    val xh: String? = null
)

@Serializable
data class BoardPendingFile(
    val id: String,
    val name: String,
    val size: Long = 0,
    val xh: String? = null
)

@Serializable
data class BoardPendingGroup(
    val pid: String,
    val action: String = "add",
    val gid: String? = null,
    val group: SyncGroup? = null,
    val xh: String? = null
)

@Serializable
data class BoardData(
    val assignments: List<BoardAssignment> = emptyList(),
    val files: List<BoardFile> = emptyList(),
    val pendingAssignments: List<BoardPendingAssignment> = emptyList(),
    val pendingFiles: List<BoardPendingFile> = emptyList(),
    val groups: List<BoardGroup> = emptyList(),
    val pendingGroups: List<BoardPendingGroup> = emptyList()
)
