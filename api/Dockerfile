FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY Pulse.Api/Pulse.Api.csproj Pulse.Api/
RUN dotnet restore Pulse.Api/Pulse.Api.csproj
COPY Pulse.Api/ Pulse.Api/
RUN dotnet publish Pulse.Api/Pulse.Api.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app .
# SQLite lives on a volume so issues survive container restarts.
RUN mkdir /data && chown $APP_UID /data
ENV ConnectionStrings__Pulse="Data Source=/data/pulse.db"
USER $APP_UID
EXPOSE 8080
ENTRYPOINT ["dotnet", "Pulse.Api.dll"]
