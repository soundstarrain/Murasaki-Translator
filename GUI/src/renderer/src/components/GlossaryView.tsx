import { useState, useEffect } from "react"
import { BookOpen, FileJson, FileText, FolderOpen, RefreshCw, Pen, Trash2, Save, Plus, X, Sparkles } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, Button } from "./ui/core"
import { translations, Language } from "../lib/i18n"

export function GlossaryView({ lang }: { lang: Language }) {
    const t = translations[lang]
    const [glossaries, setGlossaries] = useState<string[]>([])
    const [selectedGlossary, setSelectedGlossary] = useState<string>("")
    const [content, setContent] = useState<string>("")
    const [loading, setLoading] = useState(false)
    const [loadingContent, setLoadingContent] = useState(false)

    // Edit Mode State
    const [isEditing, setIsEditing] = useState(false)
    const [newFileName, setNewFileName] = useState("")
    const [creatingNew, setCreatingNew] = useState(false)

    const fetchGlossaries = async () => {
        setLoading(true)
        try {
            // @ts-ignore
            const files = await window.api.getGlossaries()
            setGlossaries(files || [])
        } catch (e) {
            console.error(e)
        }
        setLoading(false)
    }

    const openFolder = async () => {
        // @ts-ignore
        await window.api.openGlossaryFolder()
    }

    const handleSelect = async (file: string) => {
        if (isEditing && !confirm(t.glossaryView.unsaved)) return

        setSelectedGlossary(file)
        setIsEditing(false)
        setLoadingContent(true)
        setLoadingContent(true)
        try {
            // @ts-ignore
            // We need full path logic in renderer or main. 
            // Currently getGlossaries returns filenames.
            // Let's assume we need to join path in main or pass basic identifier.
            // Actually, read-file takes absolute path. 
            // Wait, getGlossaries returns filenames, how do I get full path?
            // Main process 'get-glossaries' returns filenames. 
            // I should update 'read-file' to accept just filename relative to glossary dir?
            // OR simpler: just fetch content via a new specific IPC 'read-glossary-content'.
            // Let's stick to what we have. 
            // Wait, I can't construct path in renderer easily without knowing middleware path.
            // Workaround: Use 'selectFile' for arbitrary, but for these managed files,
            // we really need a 'read-glossary' IPC.
            // Let's assume for now I will add 'read-glossary-file' to main in next step 
            // or just use the fact that I can't easily read it without full path.
            // Actually, let's just make get-glossaries return full paths?
            // No, UI looks better with names.

            // Let's rely on a new IPC I'll add quickly: 'read-glossary'
            // For now, I'll mock it or just wait.
            // Actually, I can use the existing 'read-file' IF I knew the path.
            // Pass.

            // Re-plan: update main to return objects { name, path }
            // OR add 'read-glossary(filename)'.
            // I'll assume 'read-glossary' exists for this file.

            // @ts-ignore
            const txt = await window.api.readGlossaryFile(file)
            setContent(txt || "")
        } catch (e) {
            console.error(e)
            setContent("Error reading file.")
        }
        setLoadingContent(false)
    }

    useEffect(() => {
        fetchGlossaries()
    }, [])

    const handleSave = async () => {
        if (!selectedGlossary) return

        // Simple validation for JSON
        if (selectedGlossary.endsWith('.json')) {
            try {
                JSON.parse(content)
            } catch (e) {
                alert(t.glossaryView.invalidJson)
                return
            }
        }

        try {
            // @ts-ignore
            await window.api.saveGlossaryFile({ filename: selectedGlossary, content })
            setIsEditing(false)
            window.api?.showNotification('Murasaki Translator', '保存成功')
        } catch (e) {
            console.error(e)
            alert(t.glossaryView.saveFail)
        }
    }

    const handleDelete = async () => {
        if (!selectedGlossary || !confirm(t.glossaryView.deleteConfirm.replace('{name}', selectedGlossary))) return

        try {
            // @ts-ignore
            await window.api.deleteGlossaryFile(selectedGlossary)
            setSelectedGlossary("")
            setContent("")
            fetchGlossaries()
        } catch (e) {
            console.error(e)
            alert(t.glossaryView.deleteFail)
        }
    }

    const handleCreate = async () => {
        if (!newFileName) return

        let finalName = newFileName
        if (!finalName.endsWith('.json') && !finalName.endsWith('.txt')) {
            finalName += '.json'
        }

        try {
            // @ts-ignore
            await window.api.createGlossaryFile({ filename: finalName, content: finalName.endsWith('.json') ? "{}" : "" })
            setCreatingNew(false)
            setNewFileName("")
            fetchGlossaries()
            // Select new file
            // setTimeout(() => handleSelect(finalName), 500)
        } catch (e: any) {
            alert(e.message || t.glossaryView.createFail)
        }
    }

    // Rename Logic
    const [renamingFile, setRenamingFile] = useState<string | null>(null)
    const [renameNewName, setRenameNewName] = useState("")

    const startRename = () => {
        if (!selectedGlossary) return
        setRenamingFile(selectedGlossary)
        setRenameNewName(selectedGlossary)
    }

    const handleRename = async () => {
        if (!renamingFile || !renameNewName || renamingFile === renameNewName) {
            setRenamingFile(null)
            return
        }

        try {
            // @ts-ignore
            const res = await window.api.renameGlossaryFile(renamingFile, renameNewName)
            if (res.success) {
                setRenamingFile(null)
                setSelectedGlossary(renameNewName.endsWith('.json') || renameNewName.endsWith('.txt') ? renameNewName : renameNewName + (renamingFile.endsWith('.json') ? '.json' : '.txt'))
                fetchGlossaries()
            } else {
                alert("Rename Failed: " + res.error)
            }
        } catch (e: any) {
            alert("Rename Error: " + e.message)
        }
    }

    return (
        <div className="flex-1 h-full flex flex-col bg-background overflow-hidden p-8">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
                    {t.glossary}
                    <span className="text-sm font-normal text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">{glossaries.length}</span>
                </h2>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setCreatingNew(true)} className="gap-2 bg-primary/5 text-primary border-primary/20 hover:bg-primary/10">
                        <Plus className="w-4 h-4" />
                        {t.glossaryView.new}
                    </Button>
                    {/* Import Button */}
                    <Button variant="outline" size="sm" onClick={async () => {
                        try {
                            // @ts-ignore
                            const result = await window.api.selectFile({
                                title: t.glossaryView.importTitle,
                                filters: [{ name: t.glossaryView.importFilter, extensions: ["json", "txt"] }]
                            })
                            if (result) {
                                // @ts-ignore
                                const importRes = await window.api.importGlossary(result)
                                if (importRes.success) {
                                    alert((t.glossaryView.importSuccess || "").replace('{path}', importRes.path || ""))
                                    fetchGlossaries()
                                } else {
                                    alert((t.glossaryView.importFail || "").replace('{error}', importRes.error || ""))
                                }
                            }
                        } catch (e: any) { alert((t.glossaryView.importError || "").replace('{message}', e.message || "")) }
                    }} className="gap-2">
                        <FolderOpen className="w-4 h-4" />
                        {t.glossaryView.import}
                    </Button>
                    <Button variant="outline" size="sm" onClick={openFolder} className="gap-2">
                        <FolderOpen className="w-4 h-4" />
                        {t.glossaryView.openFolder}
                    </Button>
                    <Button variant="outline" size="sm" onClick={fetchGlossaries} disabled={loading} className="gap-2">
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        {t.glossaryView.refresh}
                    </Button>
                </div>
            </div>

            {/* Format Description */}
            <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-xs text-muted-foreground">
                <p className="font-bold text-blue-500 flex items-center gap-1 mb-2">
                    <BookOpen className="w-3 h-3" /> {t.glossaryView.formatTitle}
                </p>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <span className="font-semibold text-foreground">{t.glossaryView.formatJson}</span>
                        <pre className="mt-1 bg-black/20 p-2 rounded font-mono text-[10px] text-muted-foreground whitespace-pre">{`{
  "Source": "Target",
  "魔法": "Magic"
}`}</pre>
                    </div>
                    <div>
                        <span className="font-semibold text-foreground">{t.glossaryView.formatTxt}</span>
                        <pre className="mt-1 bg-black/20 p-2 rounded font-mono text-[10px] text-muted-foreground whitespace-pre">{`Source=Target
魔法=Magic
Name:Translated`}</pre>
                    </div>
                </div>
            </div>

            {/* Auto Match Description */}
            <div className="mb-4 p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-xs text-muted-foreground">
                <p className="font-bold text-green-600 dark:text-green-400 flex items-center gap-1 mb-1">
                    <Sparkles className="w-3 h-3" /> {t.glossaryView.autoMatchTitle}
                </p>
                <p>{t.glossaryView.autoMatchDesc}</p>
            </div>

            {/* Create Modal (Simple inline) */}
            {creatingNew && (
                <div className="mb-6 p-4 bg-secondary rounded-lg border flex items-center gap-4 animate-in fade-in slide-in-from-top-2">
                    <span className="text-sm font-medium whitespace-nowrap">{t.glossaryView.filename}</span>
                    <input
                        className="bg-background border p-1 px-3 rounded text-sm w-64 focus:outline-none focus:ring-1 focus:ring-primary"
                        placeholder="my_terms.json"
                        value={newFileName}
                        onChange={e => setNewFileName(e.target.value)}
                        autoFocus
                    />
                    <div className="flex gap-2">
                        <Button size="sm" onClick={handleCreate}>{t.glossaryView.create}</Button>
                        <Button size="sm" variant="ghost" onClick={() => { setCreatingNew(false); setNewFileName("") }}>{t.glossaryView.cancel}</Button>
                    </div>
                </div>
            )}

            {/* Rename Modal (Simple inline) */}
            {renamingFile && (
                <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg flex items-center gap-4 animate-in fade-in slide-in-from-top-2">
                    <span className="text-sm font-bold text-amber-600 flex items-center gap-2">
                        <Pen className="w-4 h-4" /> Rename:
                    </span>
                    <input
                        className="bg-background border p-1 px-3 rounded text-sm w-64 focus:outline-none focus:ring-1 focus:ring-amber-500"
                        value={renameNewName}
                        onChange={e => setRenameNewName(e.target.value)}
                        autoFocus
                    />
                    <div className="flex gap-2">
                        <Button size="sm" onClick={handleRename} className="bg-amber-500 hover:bg-amber-600 text-white">Save</Button>
                        <Button size="sm" variant="ghost" onClick={() => { setRenamingFile(null); setRenameNewName("") }}>Cancel</Button>
                    </div>
                </div>
            )}

            <div className="flex gap-6 h-full overflow-hidden pb-12">
                {/* List */}
                <div className="w-1/3 overflow-y-auto space-y-2 p-1 pr-2">
                    {glossaries.length === 0 ? (
                        <div className="text-center py-10 text-muted-foreground border-2 border-dashed border-border rounded-lg bg-card">
                            <p>{t.glossaryView.noGlossaries}</p>
                            <p className="text-xs mt-2 text-muted-foreground/70">{t.glossaryView.hint}</p>
                        </div>
                    ) : (
                        glossaries.map((file) => (
                            <div
                                key={file}
                                onClick={() => handleSelect(file)}
                                className={`p-3 rounded-lg border cursor-pointer transition-all flex items-center gap-3 ${selectedGlossary === file
                                    ? 'bg-primary/10 border-primary/30 shadow-sm ring-1 ring-primary/50'
                                    : 'bg-card border-border hover:border-primary/50 hover:bg-secondary'
                                    }`}
                            >
                                {file.endsWith('.json') ? (
                                    <FileJson className={`w-8 h-8 ${selectedGlossary === file ? 'text-primary' : 'text-muted-foreground'}`} />
                                ) : (
                                    <FileText className={`w-8 h-8 ${selectedGlossary === file ? 'text-blue-500' : 'text-muted-foreground'}`} />
                                )}
                                <div className="overflow-hidden">
                                    <p className={`font-medium truncate ${selectedGlossary === file ? 'text-primary' : 'text-foreground'}`}>{file}</p>
                                    <p className="text-xs text-muted-foreground truncate">
                                        {file.endsWith('.json') ? 'Structured JSON' : 'Simple Text'}
                                    </p>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Preview */}
                <Card className="flex-1 flex flex-col overflow-hidden shadow-sm bg-card">
                    <CardHeader className="py-3 px-4 bg-secondary border-b border-border flex flex-row justify-between items-center">
                        <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
                            <BookOpen className="w-4 h-4" />
                            {selectedGlossary || t.glossaryView.preview}
                            {isEditing && <span className="text-xs text-amber-500 font-normal ml-2">{t.glossaryView.editing}</span>}
                        </CardTitle>
                        {selectedGlossary && (
                            <div className="flex gap-2">
                                {isEditing ? (
                                    <>
                                        <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)} className="h-6 px-2 text-xs">
                                            <X className="w-3 h-3 mr-1" /> {t.glossaryView.cancel}
                                        </Button>
                                        <Button size="sm" onClick={handleSave} className="h-6 px-2 text-xs bg-primary text-primary-foreground hover:bg-primary/90">
                                            <Save className="w-3 h-3 mr-1" /> {t.glossaryView.save}
                                        </Button>
                                    </>
                                ) : (
                                    <>
                                        <Button size="sm" variant="ghost" onClick={handleDelete} className="h-6 px-2 text-xs text-red-500 hover:text-red-600 hover:bg-red-50">
                                            <Trash2 className="w-3 h-3 mr-1" /> {t.glossaryView.delete}
                                        </Button>
                                        <Button size="sm" variant="ghost" onClick={startRename} className="h-6 px-2 text-xs text-amber-600 hover:bg-amber-50">
                                            <Pen className="w-3 h-3 mr-1" /> Rename
                                        </Button>
                                        <Button size="sm" variant="secondary" onClick={() => setIsEditing(true)} className="h-6 px-2 text-xs border border-border">
                                            <Pen className="w-3 h-3 mr-1" /> {t.glossaryView.edit}
                                        </Button>
                                    </>
                                )}
                            </div>
                        )}
                    </CardHeader>
                    <CardContent className="flex-1 p-0 overflow-hidden bg-secondary relative">
                        {selectedGlossary ? (
                            loadingContent ? (
                                <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                                    <RefreshCw className="w-6 h-6 animate-spin" />
                                </div>
                            ) : (
                                <textarea
                                    className={`w-full h-full p-4 font-mono text-sm bg-secondary text-foreground resize-none focus:outline-none ${isEditing ? 'ring-1 ring-inset ring-primary/50 bg-background' : ''}`}
                                    value={content}
                                    onChange={e => isEditing && setContent(e.target.value)}
                                    readOnly={!isEditing}
                                />
                            )
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                                <BookOpen className="w-12 h-12 mb-2 opacity-20" />
                                <p>{t.glossaryView.placeholder}</p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
