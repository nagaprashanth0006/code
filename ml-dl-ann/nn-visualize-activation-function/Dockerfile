FROM node:20-alpine AS build

WORKDIR /app

RUN printf '{\n\
  "name": "nn-lab",\n\
  "private": true,\n\
  "version": "1.0.0",\n\
  "type": "module",\n\
  "scripts": { "build": "vite build" },\n\
  "dependencies": { "react": "^18.2.0", "react-dom": "^18.2.0" },\n\
  "devDependencies": { "@vitejs/plugin-react": "^4.2.0", "vite": "^5.0.0" }\n\
}\n' > package.json

RUN npm install

RUN printf 'import { defineConfig } from "vite";\n\
import react from "@vitejs/plugin-react";\n\
export default defineConfig({ plugins: [react()] });\n' > vite.config.js

RUN printf '<!DOCTYPE html>\n\
<html lang="en">\n\
<head>\n\
  <meta charset="UTF-8" />\n\
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n\
  <title>Neural Network Lab</title>\n\
</head>\n\
<body>\n\
  <div id="root"></div>\n\
  <script type="module" src="/src/main.jsx"></script>\n\
</body>\n\
</html>\n' > index.html

RUN mkdir -p src && printf 'import React from "react";\n\
import ReactDOM from "react-dom/client";\n\
import App from "./App.jsx";\n\
ReactDOM.createRoot(document.getElementById("root")).render(<App />);\n' > src/main.jsx

COPY neural-network-lab.jsx src/App.jsx

RUN npm run build

#################################################################################################################

FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html

RUN printf 'server {\n\
    listen 80;\n\
    server_name localhost;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
    location / { try_files $uri $uri/ /index.html; }\n\
    location ~* \\.(js|css|png|jpg|ico|svg|woff2?)$ {\n\
        expires 30d;\n\
        add_header Cache-Control "public, immutable";\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
