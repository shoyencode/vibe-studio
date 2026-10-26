#ifndef AppVersion
  #error AppVersion is required
#endif
#ifndef AssetsDir
  #error AssetsDir is required
#endif
#ifndef WizardAppearance
  #define WizardAppearance "modern dynamic"
#endif

; Vibe Studio's Windows assistant keeps native controls, keyboard navigation and
; system appearance. Branding comes from the existing logo, blue and typography.
; Preparation reports real phases; only a known download size earns a percentage.

[Setup]
AppId=VibeStudio.Desktop{param:TestInstall|}
AppName=Vibe Studio
AppVersion={#AppVersion}
AppPublisher=Vibe Studio
DefaultDirName={localappdata}\Programs\Vibe Studio
DefaultGroupName=Vibe Studio
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.19045
OutputDir={#OutputDir}
OutputBaseFilename=Vibe Studio-Setup-{#AppVersion}-x64
UninstallDisplayIcon={uninstallexe}
SetupIconFile={#AssetsDir}\setup.ico
WizardStyle={#WizardAppearance}
WizardImageFile={#AssetsDir}\wizard-light.png
WizardImageFileDynamicDark={#AssetsDir}\wizard-dark.png
WizardSmallImageFile={#AssetsDir}\wizard-small.png
WizardSmallImageFileDynamicDark={#AssetsDir}\wizard-small.png
WizardSizePercent=130,135
WizardResizable=yes
DisableWelcomePage=no
DisableProgramGroupPage=yes
Compression=lzma2/fast
SolidCompression=yes
SetupLogging=yes
UsePreviousLanguage=no
CloseApplications=no
RestartApplications=no
LicenseFile=..\..\LICENSE
ChangesEnvironment=no
VersionInfoProductName=Vibe Studio
VersionInfoDescription=Vibe Studio installer
VersionInfoVersion={#AppVersion}

[Languages]
Name: english; MessagesFile: compiler:Default.isl
Name: french; MessagesFile: compiler:Languages\French.isl

[LangOptions]
DialogFontName=Segoe UI
DialogFontSize=10

[Messages]
english.WelcomeLabel1=Welcome to%nVibe Studio
french.WelcomeLabel1=Bienvenue dans%nVibe Studio
english.WelcomeLabel2=Your AI kits and agents, together in a desktop application.%n%nThe base installs without downloads.%nAdditional tools are yours to choose.%n%nFor your account only. No administrator rights.%nYour Windows PATH stays unchanged.
french.WelcomeLabel2=Vos kits et agents IA, réunis dans une application de bureau.%n%nLe socle s'installe sans téléchargement.%nLes outils complémentaires sont à votre choix.%n%nPour votre compte, sans droit administrateur.%nVotre PATH Windows reste inchangé.
english.SelectComponentsLabel2=Choose your setup. Compatible tools are reused; only missing tools are downloaded.
french.SelectComponentsLabel2=Choisissez votre configuration. Les outils compatibles sont réutilisés ; seuls les outils manquants sont téléchargés.
english.ReadyLabel1=Review your choices. The application installs privately for your account.
french.ReadyLabel1=Vérifiez vos choix. L'application s'installe dans votre espace personnel.
english.FinishedHeadingLabel=Vibe Studio is ready
french.FinishedHeadingLabel=Vibe Studio est prêt

[Types]
Name: recommended; Description: "{cm:Recommended}"
Name: offline; Description: "{cm:Offline}"
Name: custom; Description: "{cm:CustomType}"; Flags: iscustom

[Components]
Name: app; Description: "{cm:BaseComponent}"; Types: recommended offline custom; Flags: fixed
Name: git; Description: "{cm:GitComponent}"; Types: recommended
Name: apm; Description: "{cm:ApmComponent}"; Types: recommended
Name: claude; Description: "{cm:ClaudeComponent}"
Name: codex; Description: "{cm:CodexComponent}"
Name: gemini; Description: "{cm:GeminiComponent}"

[Tasks]
Name: desktopicon; Description: "{cm:CreateDesktopIcon}"; Flags: unchecked

[Files]
Source: "install-tools.ps1"; Flags: dontcopy
Source: "components.json"; Flags: dontcopy
Source: "gemini\package.json"; DestName: gemini-package.json; Flags: dontcopy
Source: "gemini\package-lock.json"; DestName: gemini-package-lock.json; Flags: dontcopy
Source: "{#AppSource}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs solidbreak
Source: "{tmp}\vibe-tools\*"; DestDir: "{app}\tools"; Flags: external ignoreversion recursesubdirs createallsubdirs skipifsourcedoesntexist
Source: "{tmp}\vibe-tools-result.txt"; DestDir: "{app}\setup"; DestName: installation-result.txt; Flags: external ignoreversion
Source: "{tmp}\vibe-tools-result.txt.ini"; DestDir: "{app}\setup"; DestName: installation-result.ini; Flags: external ignoreversion

[Icons]
Name: "{userprograms}\Vibe Studio"; Filename: "{app}\Vibe Studio.exe"; IconFilename: "{app}\Vibe Studio.ico"; AppUserModelID: VibeStudio.Desktop; Check: CreateShortcuts
Name: "{userprograms}\Vibe Studio tools"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoLogo -NoProfile -NoExit -ExecutionPolicy Bypass -File ""{app}\setup\tools-shell.ps1"""; WorkingDir: "{app}"; Check: CreateShortcuts
Name: "{userdesktop}\Vibe Studio"; Filename: "{app}\Vibe Studio.exe"; IconFilename: "{app}\Vibe Studio.ico"; Tasks: desktopicon; AppUserModelID: VibeStudio.Desktop; Check: CreateShortcuts

[Run]
Filename: "{app}\Vibe Studio.exe"; Description: "{cm:LaunchProgram,Vibe Studio}"; Flags: nowait postinstall skipifsilent unchecked
Filename: "{app}\setup\installation-result.txt"; Description: "{cm:ViewResult}"; Flags: shellexec postinstall skipifsilent unchecked

[CustomMessages]
english.Recommended=Recommended - Git and APM
french.Recommended=Recommandée - Git et APM
english.Offline=Offline application only
french.Offline=Application seule, hors ligne
english.CustomType=Custom installation
french.CustomType=Installation personnalisée
english.BaseComponent=Vibe Studio (included)
french.BaseComponent=Vibe Studio (inclus)
english.GitComponent=Git for Windows + Git Bash
french.GitComponent=Git pour Windows + Git Bash
english.ApmComponent=Microsoft APM
french.ApmComponent=Microsoft APM
english.ClaudeComponent=Claude Code
french.ClaudeComponent=Claude Code
english.CodexComponent=OpenAI Codex
french.CodexComponent=OpenAI Codex
english.GeminiComponent=Gemini CLI
french.GeminiComponent=Gemini CLI
english.BaseDetail=Offline base: Electron, Copilot, Python.
french.BaseDetail=Socle hors ligne : Electron, Copilot, Python.
english.GitDetail=Recommended. Required by APM and Claude Code.
french.GitDetail=Recommandé. Requis pour APM et Claude Code.
english.ApmDetail=Recommended. Deploys project kits; requires Git.
french.ApmDetail=Recommandé. Déploie les kits ; nécessite Git.
english.ClaudeDetail=Optional. Git Bash and Anthropic terms required.
french.ClaudeDetail=Facultatif. Git Bash et conditions Anthropic.
english.CodexDetail=Optional. Personal OpenAI sign-in required.
french.CodexDetail=Facultatif. Connexion OpenAI personnelle.
english.GeminiDetail=Optional. Private Node.js included if needed.
french.GeminiDetail=Facultatif. Node.js privé si nécessaire.
english.ComponentsNote=Options may need Internet. Tools stay private; no account or kit is configured automatically.
french.ComponentsNote=Les options peuvent nécessiter Internet. Outils privés ; aucun compte ni kit configuré automatiquement.
english.ToolsTitle=Preparing your tools
french.ToolsTitle=Préparation de vos outils
english.ToolsDescription=Existing tools are checked before any download.
french.ToolsDescription=Les outils existants sont vérifiés avant tout téléchargement.
english.ToolsHint=Verified downloads. Private installation. Your existing tools stay untouched.
french.ToolsHint=Téléchargements vérifiés. Installation privée. Vos outils existants sont préservés.
english.Nameapp=Vibe Studio
french.Nameapp=Vibe Studio
english.Namegit=Git + Git Bash
french.Namegit=Git + Git Bash
english.Nameapm=Microsoft APM
french.Nameapm=Microsoft APM
english.Nameclaude=Claude Code
french.Nameclaude=Claude Code
english.Namecodex=OpenAI Codex
french.Namecodex=OpenAI Codex
english.Namegemini=Gemini CLI
french.Namegemini=Gemini CLI
english.Namenode=Node.js
french.Namenode=Node.js
english.Phasedetect=Checking existing tools
french.Phasedetect=Recherche des outils existants
english.Phasereuse=Compatible tool found
french.Phasereuse=Outil compatible trouvé
english.Phasedownload=Downloading
french.Phasedownload=Téléchargement
english.Phaseverify=Verifying integrity
french.Phaseverify=Vérification de l'intégrité
english.Phaseextract=Extracting files
french.Phaseextract=Extraction des fichiers
english.Phaseinstall=Installing dependencies
french.Phaseinstall=Installation des dépendances
english.Phasecheck=Checking the version
french.Phasecheck=Contrôle de la version
english.Phasecomplete=Preparation complete
french.Phasecomplete=Préparation terminée
english.Phaseerror=Preparation failed
french.Phaseerror=Échec de la préparation
english.ProgressError=Could not read tool preparation progress. See the installation log.
french.ProgressError=Impossible de lire la progression des outils. Consultez le journal d'installation.
english.ReportError=The verified tool preparation report is missing or invalid. Retry the installation.
french.ReportError=Le bilan vérifié de préparation des outils est absent ou invalide. Réessayez l'installation.
english.SummaryBase=Included offline: Electron, Copilot, GitHub sign-in helper, Python and libraries.
french.SummaryBase=Inclus hors ligne : Electron, Copilot, connexion GitHub, Python et bibliothèques.
english.SummaryNetwork=Selected options may download tools. Compatible versions are reused.
french.SummaryNetwork=Les options choisies peuvent télécharger des outils. Les versions compatibles sont réutilisées.
english.SummaryOffline=No optional tools selected. The base installs without downloads.
french.SummaryOffline=Aucun outil complémentaire sélectionné. Le socle s'installe sans téléchargement.
english.ResultInstalled=Installed privately
french.ResultInstalled=Installé dans l'espace privé
english.ResultReused=Compatible tool reused
french.ResultReused=Outil compatible réutilisé
english.FinishBase=Application and offline base installed.
french.FinishBase=Application et socle hors ligne installés.
english.FinishNext=Next: open Vibe Studio and sign in with your chosen engine. Use the Vibe Studio tools shortcut for sign-in commands.
french.FinishNext=Ensuite : ouvrez Vibe Studio et connectez votre moteur IA. Le raccourci Vibe Studio tools donne accès aux commandes de connexion.
english.ClaudeTermsTitle=Before downloading Claude Code
french.ClaudeTermsTitle=Avant de télécharger Claude Code
english.ClaudeTermsDescription=Claude Code is an optional third-party tool.
french.ClaudeTermsDescription=Claude Code est un outil tiers facultatif.
english.ClaudeTerms=You selected Claude Code. Its program will be downloaded from the official source under Anthropic's commercial terms.%n%nhttps://code.claude.com/docs/en/legal-and-compliance%n%nContinue only if these terms allow your intended use. Go back and deselect Claude Code otherwise.%n%nNo account, subscription or kit is configured by this installer.
french.ClaudeTerms=Vous avez sélectionné Claude Code. Son programme sera téléchargé depuis la source officielle, selon les conditions commerciales d'Anthropic.%n%nhttps://code.claude.com/docs/en/legal-and-compliance%n%nContinuez uniquement si ces conditions autorisent votre usage. Sinon, revenez en arrière et décochez Claude Code.%n%nCet installeur ne configure aucun compte, abonnement ou kit.
english.ToolsStatus=Checking your installation choices...
french.ToolsStatus=Vérification de vos choix d'installation...
english.ToolsFailed=Optional tools failed. Check your connection/proxy and retry, or go back and deselect the options.%n%n
french.ToolsFailed=Échec de préparation des outils. Vérifiez la connexion/proxy puis réessayez, ou revenez pour décocher les options.%n%n
english.ClaudeNeedsGit=Claude Code requires Git Bash. Select Git too, or provide Git for Windows on the PATH.
french.ClaudeNeedsGit=Claude Code nécessite Git Bash. Sélectionnez aussi Git, ou rendez Git pour Windows accessible sur le PATH.
english.ApmNeedsGit=APM requires Git to deploy kits. Select Git too, or provide compatible Git on the PATH.
french.ApmNeedsGit=APM nécessite Git pour déployer les kits. Sélectionnez aussi Git, ou rendez Git compatible accessible sur le PATH.
english.ViewResult=Read installation results and sign-in instructions
french.ViewResult=Lire le bilan et les instructions de connexion

[Code]
var
  ToolsPage: TOutputProgressWizardPage;
  ClaudeTermsPage: TOutputMsgWizardPage;
  ProgressError: String;
  LastTool, LastPhase: String;

function ToolName(const Name: String): String;
begin
  Result := CustomMessage('Name' + Name);
end;

procedure ToolOutput(const S: String; const Error, FirstLine: Boolean);
var
  Fields: TStringList;
  Name, Phase, Caption: String;
  Percent: Integer;
begin
  Log(S);
  if Error then
  begin
    ProgressError := CustomMessage('ProgressError');
    Exit;
  end;
  if Pos('VIBE|', S) <> 1 then Exit;
  Fields := TStringList.Create;
  try
    Fields.Delimiter := '|';
    Fields.StrictDelimiter := True;
    Fields.DelimitedText := S;
    if Fields.Count <> 4 then
    begin
      ProgressError := CustomMessage('ProgressError');
      Exit;
    end;
    Name := Fields[1];
    Phase := Fields[2];
    Percent := StrToIntDef(Fields[3], -2);
    if (Name = '') or (Phase = '') or
       (Pos('|' + Name + '|', '|app|git|apm|claude|codex|gemini|node|') = 0) or
       (Pos('|' + Phase + '|', '|detect|reuse|download|verify|extract|install|check|complete|error|') = 0) or
       (Percent < -1) or (Percent > 100) then
    begin
      ProgressError := CustomMessage('ProgressError');
      Exit;
    end;
    LastTool := Name;
    if Phase <> 'error' then LastPhase := Phase;
    Caption := ToolName(Name) + ' - ' + CustomMessage('Phase' + Phase);
    if (Phase = 'download') and (Percent >= 0) then
    begin
      Caption := Caption + ' (' + IntToStr(Percent) + '%)';
      ToolsPage.ProgressBar.Style := npbstNormal;
      ToolsPage.SetProgress(Percent, 100);
    end
    else
    begin
      ToolsPage.SetProgress(0, 100);
      ToolsPage.ProgressBar.Style := npbstMarquee;
    end;
    ToolsPage.SetText(Caption, CustomMessage('ToolsHint'));
    WizardForm.Refresh;
  finally
    Fields.Free;
  end;
end;

procedure InitializeWizard;
var
  Note, VersionLabel: TNewStaticText;
begin
  ToolsPage := CreateOutputProgressPage(CustomMessage('ToolsTitle'), CustomMessage('ToolsDescription'));
  ClaudeTermsPage := CreateOutputMsgPage(wpSelectComponents, CustomMessage('ClaudeTermsTitle'),
    CustomMessage('ClaudeTermsDescription'), CustomMessage('ClaudeTerms'));
  WizardForm.WelcomeLabel1.Font.Size := 22;
  WizardForm.WelcomeLabel1.Height := ScaleY(80);
  WizardForm.WelcomeLabel2.Top := WizardForm.WelcomeLabel1.Top + WizardForm.WelcomeLabel1.Height + ScaleY(16);
  WizardForm.WelcomeLabel2.Height := WizardForm.WelcomePage.ClientHeight - WizardForm.WelcomeLabel2.Top - ScaleY(24);
  WizardForm.PageNameLabel.Font.Size := 13;
  WizardForm.ReadyMemo.WordWrap := True;
  WizardForm.ReadyMemo.ScrollBars := ssVertical;
  WizardForm.ComponentsList.MinItemHeight := ScaleY(34);
  WizardForm.ComponentsList.ItemSubItem[0] := CustomMessage('BaseDetail');
  WizardForm.ComponentsList.ItemSubItem[1] := CustomMessage('GitDetail');
  WizardForm.ComponentsList.ItemSubItem[2] := CustomMessage('ApmDetail');
  WizardForm.ComponentsList.ItemSubItem[3] := CustomMessage('ClaudeDetail');
  WizardForm.ComponentsList.ItemSubItem[4] := CustomMessage('CodexDetail');
  WizardForm.ComponentsList.ItemSubItem[5] := CustomMessage('GeminiDetail');
  WizardForm.ComponentsList.ItemFontStyle[0] := [fsBold];
  WizardForm.ComponentsList.Height := WizardForm.ComponentsList.Height - ScaleY(46);
  Note := TNewStaticText.Create(WizardForm);
  Note.Parent := WizardForm.SelectComponentsPage;
  Note.SetBounds(WizardForm.ComponentsList.Left, WizardForm.ComponentsList.Top + WizardForm.ComponentsList.Height + ScaleY(10),
    WizardForm.ComponentsList.Width, ScaleY(38));
  Note.WordWrap := True;
  Note.Anchors := [akLeft, akRight, akBottom];
  Note.Caption := CustomMessage('ComponentsNote');
  VersionLabel := TNewStaticText.Create(WizardForm);
  VersionLabel.Parent := WizardForm;
  VersionLabel.SetBounds(ScaleX(20), WizardForm.NextButton.Top + ScaleY(6), ScaleX(210), ScaleY(18));
  VersionLabel.Anchors := [akLeft, akBottom];
  VersionLabel.Caption := 'Vibe Studio {#AppVersion}';
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := (PageID = ClaudeTermsPage.ID) and not WizardIsComponentSelected('claude');
end;

function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo, MemoTypeInfo,
  MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
begin
  Result := MemoDirInfo + NewLine + NewLine + CustomMessage('SummaryBase') +
    NewLine + NewLine + MemoComponentsInfo;
  if WizardSelectedComponents(False) = 'app' then
    Result := Result + NewLine + NewLine + CustomMessage('SummaryOffline')
  else
    Result := Result + NewLine + NewLine + CustomMessage('SummaryNetwork');
  if MemoTasksInfo <> '' then Result := Result + NewLine + NewLine + MemoTasksInfo;
end;

function ToolReportValid(const Report: String): Boolean;
var
  Names: TArrayOfString;
  I: Integer;
  State: String;
  Required: Boolean;
begin
  Result := False;
  if GetIniString('installation', 'success', '', Report) <> '1' then Exit;
  Names := ['git', 'apm', 'claude', 'codex', 'gemini', 'node'];
  for I := 0 to GetArrayLength(Names) - 1 do
  begin
    State := GetIniString('tools', Names[I], '', Report);
    if Names[I] = 'node' then Required := WizardIsComponentSelected('gemini')
    else Required := WizardIsComponentSelected(Names[I]);
    if (State <> 'installed') and (State <> 'reused') and ((State <> '') or Required) then Exit;
  end;
  Result := True;
end;

procedure CurPageChanged(CurPageID: Integer);
var
  Names: TArrayOfString;
  I: Integer;
  State, Report, Summary: String;
begin
  if CurPageID <> wpFinished then Exit;
  Report := ExpandConstant('{app}\setup\installation-result.ini');
  if not ToolReportValid(Report) then
    RaiseException(CustomMessage('ReportError'));
  Summary := CustomMessage('FinishBase') + #13#10;
  Names := ['git', 'apm', 'claude', 'codex', 'gemini', 'node'];
  for I := 0 to GetArrayLength(Names) - 1 do
  begin
    State := GetIniString('tools', Names[I], '', Report);
    if State = 'installed' then
      Summary := Summary + #13#10 + ToolName(Names[I]) + ' - ' + CustomMessage('ResultInstalled')
    else if State = 'reused' then
      Summary := Summary + #13#10 + ToolName(Names[I]) + ' - ' + CustomMessage('ResultReused');
  end;
  WizardForm.FinishedLabel.Caption := Summary + #13#10#13#10 + CustomMessage('FinishNext');
  WizardForm.RunList.Top := WizardForm.FinishedPage.ClientHeight - ScaleY(74);
  WizardForm.RunList.Height := ScaleY(58);
  WizardForm.FinishedLabel.AutoSize := False;
  WizardForm.FinishedLabel.Anchors := [akLeft, akTop, akRight, akBottom];
  WizardForm.FinishedLabel.SetBounds(WizardForm.FinishedLabel.Left, WizardForm.FinishedLabel.Top,
    WizardForm.FinishedLabel.Width, WizardForm.RunList.Top - WizardForm.FinishedLabel.Top - ScaleY(16));
end;

function CreateShortcuts: Boolean;
begin
  Result := ExpandConstant('{param:NoShortcuts|0}') <> '1';
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  GitPath: String;
begin
  Result := True;
  if (CurPageID = wpSelectComponents) and
     (WizardIsComponentSelected('claude') or WizardIsComponentSelected('apm')) and
     not WizardIsComponentSelected('git') then
  begin
    GitPath := FileSearch('git.exe', GetEnv('PATH'));
    if (GitPath = '') and not FileExists(ExpandConstant('{app}\tools\git\cmd\git.exe')) then
    begin
      if WizardIsComponentSelected('claude') then
        MsgBox(CustomMessage('ClaudeNeedsGit'), mbError, MB_OK)
      else
        MsgBox(CustomMessage('ApmNeedsGit'), mbError, MB_OK);
      Result := False;
    end;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Selected, Parameters: String;
  Detail: AnsiString;
  ResultCode: Integer;
begin
  Result := '';
  ProgressError := '';
  LastTool := 'app';
  LastPhase := 'detect';
  Selected := '';
  if WizardIsComponentSelected('git') then Selected := Selected + 'git,';
  if WizardIsComponentSelected('apm') then Selected := Selected + 'apm,';
  if WizardIsComponentSelected('claude') then Selected := Selected + 'claude,';
  if WizardIsComponentSelected('codex') then Selected := Selected + 'codex,';
  if WizardIsComponentSelected('gemini') then Selected := Selected + 'gemini,';
  ExtractTemporaryFile('install-tools.ps1');
  ExtractTemporaryFile('components.json');
  ExtractTemporaryFile('gemini-package.json');
  ExtractTemporaryFile('gemini-package-lock.json');
  ForceDirectories(ExpandConstant('{tmp}\gemini'));
  FileCopy(ExpandConstant('{tmp}\gemini-package.json'), ExpandConstant('{tmp}\gemini\package.json'), False);
  FileCopy(ExpandConstant('{tmp}\gemini-package-lock.json'), ExpandConstant('{tmp}\gemini\package-lock.json'), False);
  Parameters := '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' +
    ExpandConstant('{tmp}\install-tools.ps1') + '" -Root "' + ExpandConstant('{app}') +
    '" -Stage "' + ExpandConstant('{tmp}\vibe-tools') + '" -ResultFile "' +
    ExpandConstant('{tmp}\vibe-tools-result.txt') + '" -Components "' + Selected + '"';
  ToolsPage.SetText(CustomMessage('ToolsStatus'), CustomMessage('ToolsHint'));
  ToolsPage.SetProgress(0, 100);
  ToolsPage.ProgressBar.Style := npbstMarquee;
  ToolsPage.Show;
  try
    if not ExecAndLogOutput(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Parameters,
      '', SW_SHOWNORMAL, ewWaitUntilTerminated, ResultCode, @ToolOutput) then
      Result := CustomMessage('ToolsFailed') + SysErrorMessage(ResultCode)
    else if ResultCode <> 0 then
    begin
      LoadStringFromFile(ExpandConstant('{tmp}\vibe-tools-result.txt'), Detail);
      Result := CustomMessage('ToolsFailed') + ToolName(LastTool) + ' - ' +
        CustomMessage('Phase' + LastPhase) + #13#10#13#10 + UTF8Decode(Detail);
    end
    else if ProgressError <> '' then Result := ProgressError
    else if not ToolReportValid(ExpandConstant('{tmp}\vibe-tools-result.txt.ini')) then
      Result := CustomMessage('ReportError');
  finally
    ToolsPage.Hide;
  end;
end;
