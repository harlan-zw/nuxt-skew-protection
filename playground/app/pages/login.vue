<script setup lang="ts">
const { loggedIn, fetch: refreshSession } = useUserSession()
const email = ref('admin@example.com')
const loading = ref(false)
const error = ref('')

async function login() {
  loading.value = true
  error.value = ''

  try {
    await $fetch('/auth/login', {
      method: 'POST',
      body: { email: email.value },
    })
    await refreshSession()
    await navigateTo('/admin')
  }
  catch (e: any) {
    error.value = e.data?.message || 'Login failed'
  }
  finally {
    loading.value = false
  }
}

// Redirect if already logged in
watchEffect(() => {
  if (loggedIn.value) {
    navigateTo('/admin')
  }
})
</script>

<template>
  <div class="max-w-md mx-auto space-y-6">
    <div class="text-center">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">
        Admin Login
      </h1>
      <p class="text-gray-600 dark:text-gray-400 mt-2">
        Login to view live connection stats
      </p>
    </div>

    <UCard>
      <form class="space-y-4" @submit.prevent="login">
        <UFormField label="Email">
          <UInput
            v-model="email"
            type="email"
            placeholder="admin@example.com"
            required
          />
        </UFormField>

        <UAlert
          v-if="error"
          color="error"
          :title="error"
        />

        <UButton
          type="submit"
          color="primary"
          block
          :loading="loading"
        >
          Login as Admin
        </UButton>
      </form>

      <template #footer>
        <p class="text-xs text-gray-500 dark:text-gray-400 text-center">
          Demo login - any email will work with admin role
        </p>
      </template>
    </UCard>
  </div>
</template>
