import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

// 正式签名：从 native-android/release-signing.properties 读取（gitignored，本地与 CI 各自生成，
// 内容四行：storeFile / storePassword / keyAlias / keyPassword）。文件不存在时 release 不签名（本地降级）。
val releaseSigning = Properties().apply {
    val f = rootProject.file("release-signing.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "io.github.rickylxw.classinfoboard"
    compileSdk = 36

    defaultConfig {
        // 与 Capacitor 壳同 id：同一 debug 签名下安装即替换旧壳（原生端是它的继任者）
        applicationId = "io.github.rickylxw.classinfoboard"
        minSdk = 26
        targetSdk = 36
        versionCode = 13
        versionName = "1.1.0"
    }

    signingConfigs {
        if (releaseSigning.isNotEmpty()) {
            create("release") {
                storeFile = rootProject.file(releaseSigning["storeFile"] as String)
                storePassword = releaseSigning["storePassword"] as String
                keyAlias = releaseSigning["keyAlias"] as String
                keyPassword = releaseSigning["keyPassword"] as String
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            if (releaseSigning.isNotEmpty()) signingConfig = signingConfigs.getByName("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { compose = true }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    // AndroidX 锁在 SDK36 时代版本：AGP 8.13（本地已缓存）最高支持 compileSdk 36，
    // 2026.11 之后的 AndroidX 库要求 compileSdk 37（需 AGP 9 迁移），升级时一并处理
    implementation(platform("androidx.compose:compose-bom:2025.12.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.activity:activity-compose:1.11.0")
    implementation("androidx.navigation:navigation-compose:2.9.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.1")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.1")
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.media:media:1.7.0")   // NotificationCompat.MediaStyle（媒体胶囊/媒体卡片）
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.13.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
}
