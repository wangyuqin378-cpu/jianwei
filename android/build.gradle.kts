plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.ksp) apply false
    alias(libs.plugins.hilt) apply false
}

allprojects {
    dependencyLocking {
        // Kotlin 2.2 exposes kotlin-stdlib-common as a variant constraint whose
        // presence changes between AGP transform tasks. Locking that synthetic
        // edge makes an unchanged build fail; its artifact bytes remain covered
        // by strict dependency verification and the Kotlin version is exact.
        ignoredDependencies.add("org.jetbrains.kotlin:kotlin-stdlib-common")
        lockAllConfigurations()
    }
}
