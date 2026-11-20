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
    val size: Long = 0
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
