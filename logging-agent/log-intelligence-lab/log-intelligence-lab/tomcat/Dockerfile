FROM tomcat:9.0
COPY logging.properties /usr/local/tomcat/logging.properties
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
RUN curl -L -o /usr/local/tomcat/webapps/petclinic.war https://github.com/spring-projects/spring-petclinic/releases/latest/download/spring-petclinic.war
