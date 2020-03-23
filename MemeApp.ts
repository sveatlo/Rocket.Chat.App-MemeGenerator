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

interface MemesHash {
    [name: string]: { title: string; url: string; name: string };
}

export class MemeGeneratorApp extends App {
    private availableMemes: MemesHash;
    private memelinkAPIURL: string = "https://memegen.link/api/templates/";

    constructor(info: IAppInfo, logger: ILogger, accessors: IAppAccessors) {
        super(info, logger, accessors);
    }

    public async initialize(
        configurationExtend: IConfigurationExtend,
        environmentRead: IEnvironmentRead
    ): Promise<void> {
        await this.updateAvailableMemes();
        // setInterval(() => {
        //     this.updateAvailableMemes();
        // }, 5 * 60 * 1000);

        configurationExtend.slashCommands.provideSlashCommand(
            new MemeCommand(this, this.memelinkAPIURL)
        );
    }

    public async getAvailableMemes(): Promise<MemesHash> {
        if (
            !!this.availableMemes &&
            Object.keys(this.availableMemes).length > 0
        ) {
            return this.availableMemes;
        }

        const memes = await this.catchAvailableMemes(this.getAccessors().http);
        this.availableMemes = memes;
        return memes;
    }

    private async catchAvailableMemes(http: IHttp): Promise<MemesHash> {
        this.getLogger().debug("catching available memes...");

        const response = await http.get(this.memelinkAPIURL);
        if (response.statusCode != HttpStatusCode.OK || !response.data) {
            this.getLogger().debug("catching available memes failed", response);
            throw `Invalid response: ${response.statusCode}`;
        }

        let memes: MemesHash = {};
        for (const title in response.data) {
            const templateUrl = response.data[title];
            const templateName = templateUrl.replace(this.memelinkAPIURL, "");

            memes[templateName] = {
                title,
                url: templateUrl,
                name: templateName
            };
        }

        this.getLogger().debug(
            "catching available memes finished successfully",
            memes
        );
        return memes;
    }

    private async updateAvailableMemes(): Promise<void> {
        this.availableMemes = await this.catchAvailableMemes(
            this.getAccessors().http
        );
    }
}

class MemeCommand implements ISlashCommand {
    public command: string = "meme";
    public i18nDescription: string = "Generate a new meme image";
    public i18nParamsExample: string = "";
    public providesPreview: boolean = false;

    constructor(
        private readonly app: MemeGeneratorApp,
        private readonly apiUrl: string
    ) {}

    public async executor(
        context: SlashCommandContext,
        read: IRead,
        modify: IModify,
        http: IHttp,
        persist: IPersistence
    ): Promise<void> {
        const args = this.concatArgs(context.getArguments());
        const availableMemes = await this.app.getAvailableMemes();

        const builder = modify
            .getCreator()
            .startMessage()
            .setSender(context.getSender())
            .setRoom(context.getRoom());

        if (args.length > 1 && args[0] === "--list") {
            builder.setText(
                Object.values(availableMemes).reduce(
                    (accumulator, template) =>
                        `${accumulator}*${template.name}*: _${template.title}_\n`,
                    ""
                )
            );
            modify
                .getNotifier()
                .notifyUser(context.getSender(), builder.getMessage());
            return;
        }

        if (args.length < 2) {
            this.app.getLogger().debug("Invalid arguments", args);
            builder.setText(
                "Invalid arguments.\nUse the following format: `/meme template top-line bottom-line`\nFor a list of available templates, run `/meme --list`."
            );
            modify
                .getNotifier()
                .notifyUser(context.getSender(), builder.getMessage());
            return;
        }

        const meme = args[0];
        const line1 = args[1];
        const line2 = args.length > 2 ? args[2] : "";

        if (!availableMemes[meme]) {
            this.app.getLogger().debug("Unknown meme", meme);

            const availableMemesString = Object.keys(availableMemes).join(
                "`, `"
            );
            builder.setText(
                `Unknown meme.\nUse one of the following: \`${availableMemesString}\`.`
            );

            modify
                .getNotifier()
                .notifyUser(context.getSender(), builder.getMessage());

            return;
        }

        const memeUrl = `${this.apiUrl}${meme}/${line1}/${line2}`;

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
                value: availableMemes[meme].title
            },
            imageUrl: text
        });

        await modify.getCreator().finish(builder);
    }

    // TODO: handle quotes in the middle?
    private concatArgs(args: string[]): string[] {
        let newArgs: string[] = [];
        for (let i = 0; i < args.length; i++) {
            let arg: string = args[i];

            if (arg.startsWith('"')) {
                arg = arg.substring(1);

                while (true) {
                    if (arg.endsWith('"')) {
                        arg = arg.substring(0, arg.length - 1);
                        break;
                    }

                    i++;
                    if (i >= args.length) {
                        break;
                    }

                    const nextArg: string = args[i];
                    arg += ` ${nextArg}`;
                }
            }

            newArgs.push(arg);
        }

        return newArgs;
    }
}
