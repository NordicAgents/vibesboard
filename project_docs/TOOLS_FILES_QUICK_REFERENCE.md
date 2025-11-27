# Tools & Files - Quick Reference

## 🎯 **Quick Start**

### Using the Manager (Edit Mode)
```tsx
import { ToolsFilesManager } from '@/components/agents/tools-files-manager'

<ToolsFilesManager 
  agent={agent} 
  onUpdate={() => router.refresh()} 
/>
```

### Using the Display (Read-Only)
```tsx
import { ToolsFilesDisplay } from '@/components/agents/tools-files-display'

<ToolsFilesDisplay agent={agent} />
```

## 📦 **File Operations**

| Action | Method | Result |
|--------|--------|--------|
| **Upload** | Click button or drag-drop | Files → Supabase Storage |
| **Download** | Click download icon | File downloads to device |
| **Delete** | Click trash icon | File removed from storage |

## 🔧 **Tool Operations**

| Action | Method | Result |
|--------|--------|--------|
| **Select** | Click badge | Tool highlighted |
| **Deselect** | Click again | Tool unhighlighted |
| **Save** | Click "Save Tools" | Tools updated in DB |

## 📁 **File Constraints**

- **Max Size**: 10MB
- **Allowed Types**: `.pdf`, `.txt`, `.doc`, `.docx`, `.md`, `.json`, `.csv`
- **Multiple**: Yes, batch upload supported

## 🎨 **Visual Indicators**

| Element | Meaning |
|---------|---------|
| **Checkmark on badge** | Tool is selected |
| **Ring around badge** | Tool is selected |
| **Progress bar** | File uploading |
| **Green check** | Upload success |
| **Red X** | Upload failed |
| **File icon** | File in list |

## 🔄 **State Flow**

```
User Action → Validation → API/Storage → Update DB → Refresh UI → Toast
```

## ⌨️ **Keyboard Shortcuts**

- **Tab**: Navigate between elements
- **Enter/Space**: Activate buttons/badges
- **Esc**: Cancel operations (where applicable)

## 🐛 **Troubleshooting**

| Issue | Solution |
|-------|----------|
| Upload fails | Check file size and type |
| Download fails | Verify file exists |
| Tools won't save | Check API permissions |
| Progress stuck | Refresh page |

## 📊 **Performance Tips**

- Upload files < 5MB for best UX
- Batch upload max 10 files at once
- Delete unused files regularly
- Use supported file formats

## 🔐 **Security**

- Files stored in user-specific paths
- Supabase RLS policies applied
- File types validated
- Size limits enforced

## 📱 **Responsive Breakpoints**

- **Mobile** (< 640px): Stacked layout
- **Tablet** (640px - 1024px): Adaptive
- **Desktop** (> 1024px): Full features

## 🎯 **Best Practices**

1. ✅ Use descriptive file names
2. ✅ Delete unused files
3. ✅ Keep files under 5MB
4. ✅ Enable only needed tools
5. ✅ Test uploads on slow connections

## 📞 **Support**

For issues or questions:
1. Check `TOOLS_FILES_IMPLEMENTATION.md`
2. Review code comments
3. Check TypeScript types
4. Test in browser console

---

**Last Updated**: November 2025
**Version**: 1.0.0
**Status**: ✅ Production Ready
