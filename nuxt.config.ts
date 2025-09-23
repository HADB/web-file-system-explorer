// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  colorMode: {
    preference: 'dark',
    fallback: 'dark',
  },
  compatibilityDate: '2025-07-15',
  css: [
    '~/assets/main.css',
  ],
  devtools: { enabled: true },
  eslint: { config: { standalone: false } },
  fonts: {
    provider: 'local',
  },
  modules: ['@nuxt/eslint', '@nuxt/ui'],
  ssr: false,
  typescript: {
    typeCheck: true,
    tsConfig: {
      compilerOptions: {
        strict: true,
        types: ['@types/wicg-file-system-access'],
      },
    },
  },

})
