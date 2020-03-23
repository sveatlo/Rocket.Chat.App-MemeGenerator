import {
    IAppAccessors,
    ILogger,
    IEnvironmentRead,
    IConfigurationExtend,
    IRead,
    IModify,
    IHttp,
    IPersistence,
    HttpStatusCode
} from "@rocket.chat/apps-engine/definition/accessors";
import { App } from "@rocket.chat/apps-engine/definition/App";
import { SlashCommandContext } from "@rocket.chat/apps-engine/definition/slashcommands/SlashCommandContext";
import { IAppInfo } from "@rocket.chat/apps-engine/definition/metadata";
import { ISlashCommand } from "@rocket.chat/apps-engine/definition/slashcommands";

const apiUrl: string = "https://memegen.link/api/templates/";

export class MemeGeneratorApp extends App {
    constructor(info: IAppInfo, logger: ILogger, accessors: IAppAccessors) {
        super(info, logger, accessors);
    }

    public async initialize(
        configurationExtend: IConfigurationExtend,
        environmentRead: IEnvironmentRead
    ): Promise<void> {
        configurationExtend.slashCommands.provideSlashCommand(
            new MemeCommand(this)
        );
        configurationExtend.slashCommands.provideSlashCommand(
            new MemeListCommand(this)
        );
    }
}

class MemeCommand implements ISlashCommand {
    public command: string = "meme";
    public i18nDescription: string = "Generate a new meme image";
    public i18nParamsExample: string = "";
    public providesPreview: boolean = false;

    constructor(private readonly app: App) {}

    public async executor(
        context: SlashCommandContext,
        read: IRead,
        modify: IModify,
        http: IHttp,
        persist: IPersistence
    ): Promise<void> {
        const args = context.getArguments();
        const builder = modify
            .getCreator()
            .startMessage()
            .setSender(context.getSender())
            .setRoom(context.getRoom());

        if (args.length < 2) {
            this.app.getLogger().debug("Invalid arguments", args);
            builder.setText(
                "Invalid arguments.\nUse the following format: `/meme template top-line bottom-line`\nFor a list of available templates, run `/meme-list`."
            );
            modify
                .getNotifier()
                .notifyUser(context.getSender(), builder.getMessage());
            return;
        }

        const meme = args[0];
        const line1 = args[1];
        const line2 = args.length > 2 ? args[2] : "";

        this.app.getLogger().debug(args);

        const memeUrl = `${apiUrl}${meme}/${line1}/${line2}`;

        const response = await http.get(memeUrl);
        if (response.statusCode !== HttpStatusCode.OK || !response.data) {
            this.app
                .getLogger()
                .debug("Did not get a valid response", response);
            builder.setText(
                `Failed to generate meme image (status = ${response.statusCode}). Did you use a valid template?`
            );
            modify
                .getNotifier()
                .notifyUser(context.getSender(), builder.getMessage());
            return;
        }

        const text = response.data.direct.masked;

        builder.addAttachment({
            title: {
                value: meme
            },
            imageUrl: text
        });

        await modify.getCreator().finish(builder);
    }
}

class MemeListCommand implements ISlashCommand {
    public command: string = "meme-list";
    public i18nDescription: string = "Get a list of available memes";
    public i18nParamsExample: string = "";
    public providesPreview: boolean = false;

    private memesList: { title: string; url: string; name: string }[] = [];

    constructor(private readonly app: App) {}

    public async executor(
        context: SlashCommandContext,
        read: IRead,
        modify: IModify,
        http: IHttp,
        persist: IPersistence
    ): Promise<void> {
        const builder = modify
            .getCreator()
            .startMessage()
            .setSender(context.getSender())
            .setRoom(context.getRoom());

        if (this.memesList.length === 0) {
            const response = await http.get(apiUrl);
            if (response.statusCode !== HttpStatusCode.OK || !response.data) {
                this.app
                    .getLogger()
                    .debug("Did not get a valid response", response);
                builder.setText("Failed to retrieve the meme template list.");
                modify
                    .getNotifier()
                    .notifyUser(context.getSender(), builder.getMessage());
                return;
            }

            for (const title in response.data) {
                const templateUrl = response.data[title];
                const templateName = templateUrl.replace(apiUrl, "");

                this.memesList.push({
                    title,
                    url: templateUrl,
                    name: templateName
                });
            }
        }

        builder.setText(
            this.memesList.reduce(
                (accumulator, template) =>
                    `${accumulator}*${template.name}*: _${template.title}_\n`,
                ""
            )
        );
        modify
            .getNotifier()
            .notifyUser(context.getSender(), builder.getMessage());
    }
}
