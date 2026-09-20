// Review evidence only: real production renderers with explicitly synthetic input/state.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {View} from 'react-native';
import {useUnistyles} from 'react-native-unistyles';
import {Ionicons} from '@expo/vector-icons';
import {Text} from '@/components/StyledText';
import {SessionView} from '@/-session/SessionView';
import {AgentInput} from '@/components/AgentInput';
import {AgentGoalBar} from '@/components/AgentGoalBar';
import {AgentWorkGroupHeader} from '@/components/AgentWorkGroupHeader';
import {AgentQuestionModal} from '@/components/AgentQuestionModal';
import {AttachmentInputMenu} from '@/components/AttachmentInputMenu';
import {ChatList} from '@/components/ChatList';
import {MessageView} from '@/components/MessageView';
import {EmptyMessages} from '@/components/EmptyMessages';
import {QueuedMessagesPanel} from '@/components/QueuedMessagesPanel';
import {ProviderContinuationLinks} from '@/components/ProviderContinuationLinks';
import {ProviderContinuationSheet} from '@/components/ProviderContinuationSheet';
import {SessionActionsPopover} from '@/components/SessionActionsPopover';
import {SessionStatusBar} from '@/components/SessionStatusBar';
import {VoiceAssistantStatusBar} from '@/components/VoiceAssistantStatusBar';
import {MarkdownView as NativeMarkdownView} from '../../server/packages/happy-app/sources/components/markdown/MarkdownView.tsx';
import {CodeEditor as NativeCodeEditor} from '../../server/packages/happy-app/sources/components/CodeEditor.tsx';
import {CodeView} from '@/components/CodeView';
import {CommandView} from '@/components/CommandView';
import {ToolView} from '@/components/tools/ToolView';
import {ToolFullView} from '@/components/tools/ToolFullView';
import {ToolSectionView} from '@/components/tools/ToolSectionView';
import {ToolError} from '@/components/tools/ToolError';
import {ToolStatusIndicator} from '@/components/tools/ToolStatusIndicator';
import {PermissionFooter} from '@/components/tools/PermissionFooter';
import {CodexBashView} from '@/components/tools/views/CodexBashView';
import {CodexPatchView, CodexPatchViewFull} from '@/components/tools/views/CodexPatchView';
import {FileView} from '@/components/tools/views/FileView';
import {GeminiExecuteView} from '@/components/tools/views/GeminiExecuteView';
import {InlineQuestionForm} from '@/components/tools/views/InlineQuestionForm';
import {MultiEditViewFull} from '@/components/tools/views/MultiEditViewFull';
import {SubagentView} from '@/components/tools/views/SubagentView';
import {TaskView} from '@/components/tools/views/TaskView';
import {TodoView} from '@/components/tools/views/TodoView';
import {RoundButton} from '@/components/RoundButton';
import {Item} from '@/components/Item';
import {ItemGroup} from '@/components/ItemGroup';
import {SearchableListSelector} from '@/components/SearchableListSelector';
import {WebAlertModal} from '@/modal/components/WebAlertModal';
import {WebPromptModal} from '@/modal/components/WebPromptModal';
import {useSession} from '@/sync/storage';
import {useSessionStatus} from '@/utils/sessionUtils';

const noop=()=>{};
const tool=(name:string,input:any={},state='completed',result:any='Completed')=>({name,input,state,result,createdAt:1000,startedAt:1000,completedAt:3400,title:name});
const metadata={flavor:'codex',machineId:'machine-1',path:'/work/project',homeDir:'/work',host:'review-workstation',os:'darwin'};
const q={id:'scope',header:'Review scope',question:'Which verification should the agent run?',options:[{label:'Focused tests',description:'Run the component and locale checks.'},{label:'Full contract',description:'Validate all repository guardrails.'}],allowCustom:true,required:true,multiSelect:false};
const messages:any[]=[{kind:'user-text',id:'u1',localId:null,createdAt:1000,text:'Review the session UI and verify the changes.'},{kind:'agent-text',id:'a1',localId:null,createdAt:1001,text:'The UI now uses **shared tokens**.\n\n- Readable typography\n- Clear action states\n\n`pnpm test` passed for the focused suite.'}];
const childMessages:any[]=[{kind:'tool-call',id:'t1',children:[],tool:tool('Read',{file_path:'/work/project/README.md'})},{kind:'tool-call',id:'t2',children:[],tool:tool('Bash',{command:'pnpm test'},'running')},{kind:'agent-text',id:'c1',text:'Reviewed the source. The focused checks pass.',createdAt:2000}];
const patchTool:any=tool('CodexPatch',{changes:{'src/example.ts':{type:'update',unified_diff:'@@ -1 +1 @@\n-export const radius = 16;\n+export const radius = 4;'}}});
function Label({children}:any){const{theme}=useUnistyles();return <Text style={{fontSize:12,marginBottom:8,color:theme.colors.textSecondary}}>{children}</Text>}
function Stack({children}:any){return <View style={{gap:18}}>{children}</View>}
function Card({children}:any){const{theme}=useUnistyles();return <View style={{borderWidth:1,borderColor:theme.colors.divider,borderRadius:6,padding:16,gap:12}}>{children}</View>}
function Content(){
 const scene=new URLSearchParams(location.search).get('scene'); const{theme}=useUnistyles(); const session=useSession('parent'); const sessionStatus=useSessionStatus(session);
 switch(scene){
 case 'session':return <View style={{height:innerHeight-72,minHeight:560}}><SessionView id="parent"/></View>;
 case 'chat-list':return <View style={{height:innerHeight-110,minHeight:520}}><ChatList session={session}/></View>;
 case 'composer':return <AgentInput initialValue="Review the focused tests and summarize the findings." placeholder="Message the agent" onSend={noop} onAbort={noop} showAbortButton={false} autocompletePrefixes={[]} autocompleteSuggestions={async()=>[]} sessionId="parent" agentType="codex" machineName="Review workstation" currentPath="/work/project" modelMode={{key:'gpt-5',name:'GPT-5',label:'GPT-5'} as any} effortLevel={{key:'high',name:'High',label:'High'} as any} permissionMode={{key:'workspace-write',name:'Workspace write',label:'Workspace write'} as any} onPickImages={noop} onPickDeviceFiles={noop} showWebActionMenu connectionStatus={{text:sessionStatus.statusText,color:sessionStatus.statusColor,dotColor:sessionStatus.statusDotColor,isPulsing:sessionStatus.isPulsing}}/>;
 case 'messages':return <Stack>{messages.map(message=><MessageView key={message.id} message={message} sessionId="parent" metadata={metadata}/>)}</Stack>;
 case 'goal-work-queue':return <Stack><AgentGoalBar goal={{text:'Complete the UI review and verify accessibility.',capabilities:{edit:true,stop:true,clear:true}} as any} onAction={noop}/><AgentWorkGroupHeader group={{startedAt:1000,completedAt:94000} as any} expanded={false} onToggle={noop}/><AgentWorkGroupHeader group={{startedAt:1000,completedAt:94000} as any} expanded onToggle={noop} placement="trailing"/><QueuedMessagesPanel projection={{currentCount:1,pendingCount:2,currentItems:[{id:'q1',message:{text:'Run the component checks.'},attachments:[]}],pendingItems:[{id:'q2',message:{text:'Review the dark theme screenshots.'},attachments:[]},{id:'q3',message:{text:'Summarize the remaining gaps.'},attachments:[{tool:{input:{name:'review-notes.md'}}}]}]} as any}/></Stack>;
 case 'empty':return <View style={{height:500}}><EmptyMessages session={{...session,createdAt:Date.now()-180000,metadata}}/></View>;
 case 'status':return <Stack><SessionStatusBar gitBranch="feat/issue-287-kilv-ui" modelLabel="GPT-5" effortLabel="High" contextSize={72000} contextWindow={200000}/><VoiceAssistantStatusBar variant="full"/><VoiceAssistantStatusBar variant="sidebar"/></Stack>;
 case 'attachment-menu':return <AttachmentInputMenu visible anchor={{x:30,y:140,width:40,height:40}} onClose={noop} onPickPhotos={noop} onPickDeviceFiles={noop}/>;
 case 'question':return <AgentQuestionModal visible pending={{id:'review-question',kind:'form',createdAt:1,questions:[q]}} sessionId="parent" onClose={noop}/>;
 case 'continuation':return <Stack><ProviderContinuationLinks session={session}/><ProviderContinuationSheet sessionId="parent" onClose={noop}/></Stack>;
 case 'session-actions':return <SessionActionsPopover sessionId="parent" visible anchor={{type:'rect',x:30,y:110,width:280,height:40}} onClose={noop}/>;
 case 'native-editor':return <Stack><Label>Native CodeEditor imported explicitly; DOM host, editable state.</Label><View style={{height:260,borderWidth:1,borderColor:theme.colors.divider,borderRadius:6}}><NativeCodeEditor value={'export function reviewPanel() {\n  return { radius: 4, verified: true };\n}'} onChange={noop} language="typescript" darkMode={theme.dark}/></View><Label>Read-only state</Label><View style={{height:180,borderWidth:1,borderColor:theme.colors.divider,borderRadius:6}}><NativeCodeEditor value={'// Read-only fixture\nconst status = "reviewed";'} onChange={noop} language="typescript" darkMode={theme.dark} readOnly/></View></Stack>;
 case 'native-text':return <Stack><Label>Native Markdown renderer imported explicitly; hosted through React Native Web.</Label><NativeMarkdownView markdown={'## Review summary\n\n**Bold emphasis** and *italic emphasis* with [reference](https://example.com).\n\n- First check passed\n- Second check passed\n\n> Preserve the user’s content.\n\n```ts\nexport const radius = 4;\n```'}/><CodeView code={'const theme = {\n  radius: 4,\n  tone: "warm"\n};'} language="typescript"/><CommandView command="pnpm --filter happy-app test" stdout="Tests: 73 passed" stderr="Fixture output: optional provider unavailable"/></Stack>;
 case 'tool-shells':return <Stack><Card><Label>Compact tool card</Label><ToolView tool={tool('Bash',{command:'pnpm test'},'completed','73 tests passed') as any} metadata={metadata} messages={[]} sessionId="parent"/></Card><Card><Label>Codex command renderer</Label><CodexBashView tool={tool('CodexBash',{command:['pnpm','test'],parsed_cmd:[{type:'bash',cmd:'pnpm test'}]}) as any} metadata={metadata} messages={[]}/></Card><Card><Label>Gemini command renderer</Label><GeminiExecuteView tool={tool('GeminiExecute',{toolCall:{title:'pnpm test [current working directory /work/project] (Run focused checks)'}}) as any} metadata={metadata} messages={[]}/></Card></Stack>;
 case 'tool-full':return <View style={{height:620}}><ToolFullView tool={tool('review_summary',{files:12,theme:'dark'},'error','A synthetic preview error to review the error state.') as any} metadata={metadata} sessionId="parent"/></View>;
 case 'tool-states':return <Stack><ToolSectionView title="Synthetic execution states"><View style={{flexDirection:'row',gap:28}}>{['running','completed','error'].map(state=><View key={state} style={{gap:8,alignItems:'center'}}><ToolStatusIndicator tool={tool('Bash',{},state) as any}/><Text>{state}</Text></View>)}</View></ToolSectionView><ToolError message="Fixture error: the requested file is unavailable."/><PermissionFooter permission={{id:'p1',status:'pending'}} sessionId="parent" toolName="Bash" toolInput={{command:'pnpm test'}} metadata={{flavor:'claude'}}/></Stack>;
 case 'tool-patch':return <Stack><Card><Label>Compact patch</Label><CodexPatchView tool={patchTool} metadata={metadata} sessionId="parent"/></Card><Card><Label>Expanded patch</Label><CodexPatchViewFull tool={patchTool} metadata={metadata}/></Card><Card><Label>Multiple edits</Label><MultiEditViewFull tool={tool('MultiEdit',{file_path:'/work/project/src/example.ts',edits:[{old_string:'export const radius = 16;',new_string:'export const radius = 4;',replace_all:true}]}) as any} metadata={metadata}/></Card></Stack>;
 case 'tool-file':return <FileView tool={tool('file',{ref:'synthetic-image',name:'kilv-artwork-preview.png',image:{width:280,height:210}}) as any} metadata={metadata} messages={[]} sessionId="parent"/>;
 case 'tool-question':return <InlineQuestionForm questions={[q]} canInteract onSubmit={async()=>{}} onCancel={async()=>{}}/>;
 case 'tool-agents':return <Stack><Card><Label>Subagent outcome</Label><SubagentView tool={tool('Task',{},'completed',{status:'completed',detail:'The bounded source review is complete.'}) as any} metadata={metadata} messages={childMessages} sessionId="parent"/></Card><Card><Label>Task activity</Label><TaskView tool={tool('Task') as any} metadata={metadata} messages={childMessages}/></Card><Card><Label>Task checklist</Label><TodoView tool={tool('TodoWrite',{todos:[{id:'1',content:'Read the issue and project rules',status:'completed'},{id:'2',content:'Review the actual UI panels',status:'in_progress'},{id:'3',content:'Record native verification gaps',status:'pending'}]}) as any} metadata={metadata} messages={[]}/></Card></Stack>;
 case 'controls':return <Stack><View style={{gap:10}}><RoundButton title="Primary action" onPress={noop}/><RoundButton title="Secondary action" display="inverted" onPress={noop}/><RoundButton title="Unavailable action" disabled/><RoundButton title="Loading action" loading/></View><ItemGroup title="Shared item states" footer="Synthetic fixture values. Production components and styling."><Item title="Default item" subtitle="Descriptive supporting content" onPress={noop} icon={<Ionicons name="folder-outline" size={24} color={theme.colors.textLink}/>}/><Item title="Selected item" selected onPress={noop}/><Item title="Destructive action" destructive onPress={noop}/><Item title="Disabled item" disabled/></ItemGroup></Stack>;
 case 'selector':return <SearchableListSelector items={['/work/project','/work/design','/work/fixtures']} selectedItem="/work/project" recentItems={['/work/design']} favoriteItems={['/work/project']} onSelect={noop} onToggleFavorite={noop} config={{getItemId:v=>v,getItemTitle:v=>v,getItemSubtitle:()=> 'Synthetic workspace path',getItemIcon:()=> <Ionicons name="folder-outline" size={22} color={theme.colors.textLink}/>,formatForDisplay:v=>v,parseFromDisplay:v=>v,filterItem:(v,s)=>v.includes(s),searchPlaceholder:'Search workspace paths',recentSectionTitle:'Recent',favoritesSectionTitle:'Favorites',noItemsMessage:'No paths found',showFavorites:true,showRecent:true,allowCustomInput:true}}/>;
 case 'alert':return <WebAlertModal config={{id:'review-confirm',type:'confirm',title:'Delete this saved item?',message:'This synthetic confirmation does not change account data.',confirmText:'Delete',cancelText:'Cancel',destructive:true}} onClose={noop} onConfirm={noop}/>;
 case 'prompt':return <WebPromptModal config={{id:'review-prompt',type:'prompt',title:'Rename session',message:'Choose a name for this synthetic session.',defaultValue:'Review KILV panels',confirmText:'Save',cancelText:'Cancel'}} onClose={noop} onConfirm={noop}/>;
 default:return <Text>Unknown scene: {scene}</Text>;
 }
}
function App(){const{theme}=useUnistyles();const scene=new URLSearchParams(location.search).get('scene');const full=['session','chat-list'].includes(scene??'');return <View style={{minHeight:innerHeight,backgroundColor:theme.colors.surface,padding:full?0:24}}><View style={{padding:12,borderBottomWidth:1,borderColor:theme.colors.divider}}><Text style={{fontSize:12,color:theme.colors.text}}>REVIEW FIXTURE · {scene} · synthetic data · actual production components</Text></View><View testID="capture-panel" style={{width:'100%',maxWidth:full?undefined:980,alignSelf:'center',paddingTop:full?0:24}}><Content/></View></View>}
createRoot(document.getElementById('root')!).render(<App/>);
