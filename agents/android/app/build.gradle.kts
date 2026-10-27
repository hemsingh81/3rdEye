plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.thirdeye.agent"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.thirdeye.agent"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // STORY-07 / android-agent-spec.md §2: the debug source set
            // (src/debug/) is where DevStandaloneConfig.kt lives — it is
            // never part of this (release) variant's compiled sources,
            // the direct Android equivalent of the Windows agent's
            // `#if DEBUG` guard. dev-standalone-mode-spec.md §1's hard
            // rule: this must be verified absent from the release
            // artifact in CI (STORY-08), not just "not referenced."
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    // OkHttp only — android-agent-spec.md §2 explicitly says not to add
    // Retrofit for three endpoints.
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("androidx.security:security-crypto:1.1.0-alpha06") // EncryptedSharedPreferences
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    // STORY-13: F4 location — Google Play services' fused location API,
    // the standard Android mechanism (android-agent-spec.md didn't name
    // it originally since F4 wasn't in that doc's scope; same "disclosed,
    // standard API" bar as UsageStatsManager/PackageManager elsewhere).
    implementation("com.google.android.gms:play-services-location:21.3.0")
}
