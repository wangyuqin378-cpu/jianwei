package cn.jianwei.app

import android.app.NotificationManager
import com.google.common.truth.Truth.assertThat
import org.junit.Test

class ItemReminderNotificationPolicyTest {
    @Test
    fun `disabled reminder channel blocks delivery`() {
        assertThat(notificationChannelAllowsReminder(NotificationManager.IMPORTANCE_NONE)).isFalse()
    }

    @Test
    fun `enabled or pre channel Android allows delivery`() {
        assertThat(notificationChannelAllowsReminder(NotificationManager.IMPORTANCE_DEFAULT)).isTrue()
        assertThat(notificationChannelAllowsReminder(null)).isTrue()
    }
}
