FROM maven:3.9.9-eclipse-temurin-21@sha256:3a4ab3276a087bf276f79cae96b1af04f53731bec53fb2e651aca79e4b10211e
WORKDIR /gate
COPY pom.xml .
COPY src src
COPY dependency-sha256.txt dependency-sha256.lock
RUN mvn -B -q compile dependency:copy-dependencies && find target/dependency -name '*.jar' -exec sha256sum {} \; | sort > dependency-sha256.txt && diff -u dependency-sha256.lock dependency-sha256.txt
ENTRYPOINT ["java", "-cp", "target/classes:target/dependency/*", "ReaderGate"]
